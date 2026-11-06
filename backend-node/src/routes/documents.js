import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { requireAuth } from '../middleware/auth.js';
import { generateUniqueDocumentFilename } from '../utils/filename-utils.js';

dotenv.config({ quiet: true });

// Re-use native fetch if available, else import
const globalFetch = typeof fetch !== 'undefined' ? fetch : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const router = express.Router();

// Service-role client for storage operations (bypasses RLS for uploads on behalf of users)
const supabaseStorage = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// Public file URL generator:
// Returns the backend-managed document endpoint (/api/documents/:id/file) so client browsers
// and iframes stream documents directly from the backend without encountering Microsoft Dev Tunnel
// anti-phishing interstitial warning notices.
const toPublicFileUrl = (url, docId) => {
  if (docId) {
    return `/api/documents/${docId}/file`;
  }
  if (!url) return url;
  if (url.startsWith('/api/documents/')) return url;
  const match = url.match(/\/documents\/[^/]+\/([a-f0-9-]+)/i);
  if (match && match[1]) {
    return `/api/documents/${match[1]}/file`;
  }
  return url;
};

// Ensure 'documents' bucket exists with 50MB file size limit
const ensureBucket = async () => {
  try {
    const { data: bucket, error } = await supabaseStorage.storage.getBucket('documents');
    if (error && (error.status === 404 || error.message?.toLowerCase().includes('not found'))) {
      const { error: createError } = await supabaseStorage.storage.createBucket('documents', {
        public: true,
        fileSizeLimit: 50 * 1024 * 1024, // 50MB
      });
      if (createError) {
        console.warn("Could not create 'documents' bucket:", createError.message);
      }
    } else if (bucket && bucket.file_size_limit !== 50 * 1024 * 1024) {
      const { error: updateError } = await supabaseStorage.storage.updateBucket('documents', {
        public: true,
        fileSizeLimit: 50 * 1024 * 1024, // 50MB
      });
      if (updateError) {
        console.warn("Could not update 'documents' bucket limit:", updateError.message);
      }
    }
  } catch (err) {
    console.warn("Error checking/updating 'documents' bucket:", err.message);
  }
};
ensureBucket();

// Allowed MIME types for document uploads
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg'
];

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit matching config.toml
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PDF, DOC, DOCX, TXT`), false);
    }
  }
});

// List documents for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Use the auth-scoped client so RLS is respected
    const { data, error } = await req.supabase
      .from('user_documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    // Map file_urls to backend document file endpoints to prevent dev tunnel notices in iframes
    const mapped = (data || []).map((d) => ({
      ...d,
      file_url: toPublicFileUrl(d.file_url, d.id),
    }));
    res.json(mapped);
  } catch (err) {
    console.error("Error fetching documents:", err);
    res.status(500).json({ error: "Failed to fetch user documents" });
  }
});

// Upload a new document
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const docId = uuidv4();
    const ext = path.extname(req.file.originalname);
    const storagePath = `${userId}/${docId}${ext}`;

    // Upload to Supabase Storage using service-role client (bypasses storage RLS)
    const { data: uploadData, error: uploadError } = await supabaseStorage.storage
      .from('documents')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error("Supabase Storage Error:", uploadError);
      const statusCode = uploadError.statusCode ? parseInt(uploadError.statusCode, 10) : (uploadError.status || 500);
      const finalStatus = (!isNaN(statusCode) && statusCode >= 400 && statusCode < 600) ? statusCode : 500;
      return res.status(finalStatus).json({
        error: uploadError.message || (typeof uploadError === 'string' ? uploadError : "Failed to upload to storage")
      });
    }

    // Get public URL (internal localhost base for fast laptop-local download)
    const { data: publicUrlData } = supabaseStorage.storage
      .from('documents')
      .getPublicUrl(storagePath);

    const internalFileUrl = publicUrlData.publicUrl;
    // Public URL for browsers: route through backend so iframes don't encounter dev tunnel notice
    const fileUrl = toPublicFileUrl(internalFileUrl, docId);

    // Insert metadata using auth-scoped client (respects RLS)
    const { error } = await req.supabase
      .from('user_documents')
      .insert({
        id: docId,
        user_id: userId,
        filename: req.file.originalname,
        file_url: fileUrl,
        status: 'uploading'
      });

    if (error) throw error;

    // Notify the Python extraction service (same laptop: use fast internal localhost URL).
    // Logged (not silent) so stuck-'uploading' docs are diagnosable; on ping failure
    // mark the row as error instead of leaving it stuck forever.
    const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    const pingController = new AbortController();
    const pingTimeout = setTimeout(() => pingController.abort(), 10000);
    globalFetch(`${ragServiceUrl}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_url: internalFileUrl, document_id: docId, filename: req.file.originalname }),
      signal: pingController.signal,
    })
      .then(async (pingRes) => {
        clearTimeout(pingTimeout);
        if (!pingRes.ok) {
          const text = await pingRes.text().catch(() => '');
          console.error(`Python /extract ping failed for ${docId}: ${pingRes.status} ${text}`);
          await supabaseStorage.from('user_documents').update({
            status: 'error',
            error_message: 'Document extraction failed. Please ensure the analysis service is available and try again.',
          }).eq('id', docId);
        }
      })
      .catch(async (err) => {
        clearTimeout(pingTimeout);
        console.error(`Error pinging python service for ${docId}:`, err?.message || err);
        await supabaseStorage.from('user_documents').update({
          status: 'error',
          error_message: 'Could not connect to the extraction service. Please ensure the analysis service is running and try again.',
        }).eq('id', docId);
      });

    res.status(201).json({ id: docId, file_url: fileUrl, status: 'uploading' });
  } catch (err) {
    console.error("Error uploading document:", err);
    // Handle multer file type errors
    if (err.message && err.message.startsWith('Invalid file type')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// Delete a document
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const docId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get the document to find the filename/storage path
    const { data: doc, error: fetchError } = await req.supabase
      .from('user_documents')
      .select('*')
      .eq('id', docId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !doc) {
      return res.status(404).json({ error: "Document not found or unauthorized" });
    }

    // Extract file extension and storage path
    const ext = path.extname(doc.filename);
    const storagePath = `${userId}/${docId}${ext}`;

    // Delete from Supabase Storage
    const { error: storageError } = await supabaseStorage.storage
      .from('documents')
      .remove([storagePath]);

    if (storageError) {
      console.error("Storage delete error:", storageError);
      // We continue to delete from DB even if storage fails just in case
    }

    // Delete from database
    const { error: dbError } = await req.supabase
      .from('user_documents')
      .delete()
      .eq('id', docId)
      .eq('user_id', userId);

    if (dbError) throw dbError;

    res.status(200).json({ message: 'Document deleted successfully' });
  } catch (err) {
    console.error("Error deleting document:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// Stream document file for preview or download
// Bypasses Microsoft Dev Tunnel warning notices by streaming directly from local Supabase Storage
router.get(['/:id/file', '/:id/preview'], async (req, res) => {
  try {
    const docId = req.params.id;
    if (!docId) {
      return res.status(400).json({ error: 'Missing document ID' });
    }

    // Fetch document metadata using service client (bypasses RLS for preview)
    const { data: doc, error: fetchError } = await supabaseStorage
      .from('user_documents')
      .select('*')
      .eq('id', docId)
      .single();

    if (fetchError || !doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Optional user verification if auth token is supplied
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.startsWith('Bearer '))
      ? authHeader.substring(7).trim()
      : (req.query.token ? String(req.query.token).trim() : null);

    if (token) {
      try {
        const { data: { user } } = await supabaseStorage.auth.getUser(token);
        if (user && user.id !== doc.user_id) {
          return res.status(403).json({ error: 'Access forbidden: unauthorized user' });
        }
      } catch (_) { }
    }

    const ext = path.extname(doc.filename) || '.txt';
    const storagePath = `${doc.user_id}/${doc.id}${ext}`;

    let buffer = null;
    let mimeType = null;

    // Fast path: Download directly from local Supabase Storage (internal fast path, no dev tunnel)
    try {
      const { data: fileBlob, error: downloadError } = await supabaseStorage.storage
        .from('documents')
        .download(storagePath);

      if (!downloadError && fileBlob) {
        const arrayBuffer = await fileBlob.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        mimeType = fileBlob.type;
      }
    } catch (e) {
      console.warn(`[Document Serving] Storage download failed for ${storagePath}:`, e.message);
    }

    // Fallback: If direct download failed, try parsing storage path from file_url or fetch with bypass header
    if (!buffer && doc.file_url) {
      const parts = doc.file_url.split('/documents/');
      if (parts.length > 1) {
        const altPath = decodeURIComponent(parts[1]);
        if (altPath !== storagePath) {
          try {
            const { data: altBlob, error: altErr } = await supabaseStorage.storage
              .from('documents')
              .download(altPath);
            if (!altErr && altBlob) {
              const arrayBuffer = await altBlob.arrayBuffer();
              buffer = Buffer.from(arrayBuffer);
              mimeType = altBlob.type;
            }
          } catch (_) { }
        }
      }

      if (!buffer) {
        try {
          const fetchRes = await globalFetch(doc.file_url, {
            headers: {
              'X-Tunnel-Skip-AntiPhishing-Page': 'true',
            },
          });
          if (fetchRes.ok) {
            const arrayBuffer = await fetchRes.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
            mimeType = fetchRes.headers.get('content-type');
          }
        } catch (e) {
          console.warn(`[Document Serving] Fallback fetch failed for ${doc.file_url}:`, e.message);
        }
      }
    }

    if (!buffer) {
      return res.status(404).json({ error: 'File content could not be retrieved from storage' });
    }

    // MIME type resolution
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.txt': 'text/plain; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
    };
    const resolvedMime = mimeTypes[ext.toLowerCase()] || mimeType || 'application/octet-stream';

    const isDownload = req.query.download === '1' || req.query.download === 'true';
    const disposition = isDownload ? 'attachment' : 'inline';

    const downloadName = path.extname(doc.filename) ? doc.filename : `${doc.filename}.txt`;
    res.setHeader('Content-Type', resolvedMime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(downloadName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    return res.send(buffer);
  } catch (err) {
    console.error('[Document Serving] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error while retrieving document' });
  }
});

// Get canvas content for a document
router.get('/:id/canvas', requireAuth, async (req, res) => {
  try {
    const docId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data: doc, error } = await req.supabase
      .from('user_documents')
      .select('id, filename, file_url, extracted_text, canvas_content, canvas_html, canvas_updated_at')
      .eq('id', docId)
      .eq('user_id', userId)
      .single();

    if (error || !doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    const activeContent = doc.canvas_content || doc.extracted_text || '';

    res.json({
      id: doc.id,
      filename: doc.filename,
      file_url: toPublicFileUrl(doc.file_url, doc.id),
      extracted_text: doc.extracted_text || '',
      canvas_content: activeContent,
      canvas_html: doc.canvas_html || null,
      canvas_updated_at: doc.canvas_updated_at,
    });
  } catch (err) {
    console.error("Error fetching canvas content:", err);
    res.status(500).json({ error: "Failed to fetch document canvas content" });
  }
});

// Update document content / canvas content
router.put(['/:id/content', '/:id/canvas'], requireAuth, async (req, res) => {
  try {
    const docId = req.params.id;
    const userId = req.user?.id;
    const { content, html, filename: newFilename } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (typeof content !== 'string') {
      return res.status(400).json({ error: "Content must be a string" });
    }

    const nowIso = new Date().toISOString();
    const updatePayload = {
      canvas_content: content,
      extracted_text: content,
      canvas_updated_at: nowIso,
    };
    if (typeof html === 'string') {
      updatePayload.canvas_html = html;
    }

    // Verify document existence and authorization
    const { data: doc, error: fetchError } = await supabaseStorage
      .from('user_documents')
      .select('id, user_id, filename, extracted_text, canvas_content')
      .eq('id', docId)
      .maybeSingle();

    if (fetchError || !doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (doc.user_id && doc.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Handle document renaming with duplicate avoidance
    if (typeof newFilename === 'string' && newFilename.trim() && newFilename.trim() !== doc.filename) {
      const { data: otherDocs } = await supabaseStorage
        .from('user_documents')
        .select('filename')
        .eq('user_id', userId)
        .neq('id', docId);

      const existingFilenames = (otherDocs || []).map((d) => d.filename);
      const cleanCandidate = (newFilename || '').trim().replace(/\.txt$/i, '');
      const resolvedFilename = generateUniqueDocumentFilename(cleanCandidate, existingFilenames, '');
      updatePayload.filename = resolvedFilename;
    }

    // Check if text content actually changed to avoid frequent redundant RAG re-embeddings
    const textChanged =
      doc.extracted_text !== content || doc.canvas_content !== content;

    const { data, error } = await supabaseStorage
      .from('user_documents')
      .update(updatePayload)
      .eq('id', docId)
      .select('*')
      .single();

    if (error) throw error;

    // Overwrite storage text file if it exists
    const storagePath = `${userId}/${docId}.txt`;
    supabaseStorage.storage
      .from('documents')
      .upload(storagePath, Buffer.from(content, 'utf-8'), {
        contentType: 'text/plain; charset=utf-8',
        upsert: true,
      })
      .catch((e) => console.warn('[Storage] Overwrite warning:', e.message));

    // Only reindex in background for RAG chat when document text actually changed
    if (textChanged) {
      const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
      globalFetch(`${ragServiceUrl}/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: docId, text: content }),
      }).catch((e) => console.warn('[Reindex] Document update reindex failed:', e.message));
    }

    res.json({ success: true, document: data, updated_at: nowIso });
  } catch (err) {
    console.error("Error saving canvas content:", err);
    res.status(500).json({ error: "Failed to update canvas content" });
  }
});

// Reset canvas content to original extracted text
router.post('/:id/reset', requireAuth, async (req, res) => {
  try {
    const docId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data: doc, error: fetchErr } = await req.supabase
      .from('user_documents')
      .select('id, extracted_text')
      .eq('id', docId)
      .eq('user_id', userId)
      .single();

    if (fetchErr || !doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    const originalText = doc.extracted_text || '';
    const nowIso = new Date().toISOString();

    const { error: updateErr } = await req.supabase
      .from('user_documents')
      .update({
        canvas_content: originalText,
        canvas_html: null,
        canvas_updated_at: nowIso,
      })
      .eq('id', docId)
      .eq('user_id', userId);

    if (updateErr) throw updateErr;

    const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    globalFetch(`${ragServiceUrl}/reindex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: docId, text: originalText }),
    }).catch((e) => console.warn('[Reindex] Reset trigger failed:', e.message));

    res.json({ success: true, canvas_content: originalText, updated_at: nowIso });
  } catch (err) {
    console.error("Error resetting canvas content:", err);
    res.status(500).json({ error: "Failed to reset canvas content" });
  }
});

// Trigger background re-indexing of canvas text into vector chunks
router.post('/:id/reindex', requireAuth, async (req, res) => {
  try {
    const docId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data: doc, error } = await req.supabase
      .from('user_documents')
      .select('id, canvas_content, extracted_text')
      .eq('id', docId)
      .eq('user_id', userId)
      .single();

    if (error || !doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    const textToReindex = doc.canvas_content || doc.extracted_text || '';
    const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

    globalFetch(`${ragServiceUrl}/reindex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: docId, text: textToReindex }),
    }).catch((e) => console.warn('[Reindex] Trigger failed:', e.message));

    res.json({ success: true, message: "Reindexing queued" });
  } catch (err) {
    console.error("Error queueing reindex:", err);
    res.status(500).json({ error: "Failed to queue reindexing" });
  }
});

// Export document canvas as .docx or .txt
router.get('/:id/export', requireAuth, async (req, res) => {
  try {
    const docId = req.params.id;
    const userId = req.user?.id;
    const format = (req.query.format || 'txt').toString().toLowerCase();

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data: doc, error } = await req.supabase
      .from('user_documents')
      .select('id, filename, canvas_content, extracted_text')
      .eq('id', docId)
      .eq('user_id', userId)
      .single();

    if (error || !doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    const content = doc.canvas_content || doc.extracted_text || '';
    const baseName = doc.filename ? doc.filename.replace(/\.[^/.]+$/, "") : "document";

    if (format === 'pdf') {
      const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
      try {
        const pdfRes = await globalFetch(`${ragServiceUrl}/export-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: `${baseName}.pdf`, content, html: doc.canvas_html || '' }),
        });
        if (pdfRes.ok) {
          const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}_revised.pdf"`);
          return res.send(pdfBuf);
        }
      } catch (e) {
        console.warn('[Export] PDF generation service failed, falling back to TXT:', e.message);
      }
    }

    if (format === 'docx') {
      const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
      try {
        const docxRes = await globalFetch(`${ragServiceUrl}/export-docx`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: `${baseName}.docx`, content }),
        });
        if (docxRes.ok) {
          const docxBuf = Buffer.from(await docxRes.arrayBuffer());
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}_revised.docx"`);
          return res.send(docxBuf);
        }
      } catch (e) {
        console.warn('[Export] DOCX generation service failed, falling back to TXT:', e.message);
      }
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}_revised.txt"`);
    return res.send(Buffer.from(content, 'utf-8'));
  } catch (err) {
    console.error("Error exporting canvas document:", err);
    res.status(500).json({ error: "Failed to export document" });
  }
});

// Export document directly to Word docx
router.post('/export-docx', async (req, res) => {
  try {
    const { filename, content, signatures } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }
    const safeFilename = filename || "document.docx";
    const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    try {
      const docxRes = await globalFetch(`${ragServiceUrl}/export-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: safeFilename, content, signatures }),
      });
      if (docxRes.ok) {
        const docxBuf = Buffer.from(await docxRes.arrayBuffer());
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
        return res.send(docxBuf);
      }
    } catch (e) {
      console.warn('[Export] Direct DOCX generation service failed:', e.message);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename.replace(/\.docx$/, '.txt'))}"`);
    return res.send(Buffer.from(content, 'utf-8'));
  } catch (err) {
    console.error("Error exporting docx:", err);
    res.status(500).json({ error: "Failed to export document" });
  }
});

// Export document directly to PDF
router.post('/export-pdf', async (req, res) => {
  try {
    const { filename, content, html, signatures, margin_preset, font_size } = req.body;
    if (!content && !html) {
      return res.status(400).json({ error: "Content or HTML is required" });
    }
    const safeFilename = filename || "document.pdf";
    const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    try {
      const pdfRes = await globalFetch(`${ragServiceUrl}/export-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: safeFilename,
          content: content || '',
          html: html || '',
          signatures: signatures || {},
          margin_preset: margin_preset || 'sc_standard',
          font_size: font_size || '12pt',
        }),
      });
      if (pdfRes.ok) {
        const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
        return res.send(pdfBuf);
      }
    } catch (e) {
      console.warn('[Export] Direct PDF generation service failed:', e.message);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename.replace(/\.pdf$/, '.txt'))}"`);
    return res.send(Buffer.from(content || '', 'utf-8'));
  } catch (err) {
    console.error("Error exporting pdf:", err);
    res.status(500).json({ error: "Failed to export document" });
  }
});

// Create a new document from a legal template build
router.post('/create-from-template', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { template_id, title, filename: requestedFilename, content, fields, signatures } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: "Document content is required" });
    }

    const docId = uuidv4();

    // Query existing documents for this user to avoid duplicate filenames
    const { data: userDocs } = await supabaseStorage
      .from('user_documents')
      .select('filename')
      .eq('user_id', userId);
    const existingFilenames = (userDocs || []).map((d) => d.filename);

    const baseCandidate = (requestedFilename && requestedFilename.trim()) || title || template_id || "Legal Document";
    const cleanCandidate = baseCandidate.replace(/\.txt$/i, "");
    const filename = generateUniqueDocumentFilename(cleanCandidate, existingFilenames, "");
    const ext = path.extname(filename) || '.txt';
    const storagePath = `${userId}/${docId}${ext}`;
    const buffer = Buffer.from(content, 'utf-8');

    // Upload to Supabase Storage bucket
    const { error: uploadError } = await supabaseStorage.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: 'text/plain; charset=utf-8',
        upsert: true,
      });

    if (uploadError) {
      console.warn("Storage upload warning, continuing with DB insert:", uploadError.message);
    }

    const fileUrl = toPublicFileUrl(`/api/documents/${docId}/file`, docId);
    const nowIso = new Date().toISOString();

    const metadataJson = JSON.stringify({
      template_id: template_id || '',
      title: title || '',
      fields: fields || {},
      signatures: signatures || {},
      is_builder_document: true,
      created_from_builder: true,
    });

    const insertPayload = {
      id: docId,
      user_id: userId,
      filename,
      file_url: fileUrl,
      status: 'completed',
      extracted_text: content,
      canvas_content: content,
      canvas_html: metadataJson,
      canvas_updated_at: nowIso,
    };

    const { data: newDoc, error: insertError } = await supabaseStorage
      .from('user_documents')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError) throw insertError;

    // Asynchronously notify Python service to vectorize and index document for chat
    const ragServiceUrl = (process.env.RAG_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    globalFetch(`${ragServiceUrl}/reindex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: docId, text: content }),
    }).catch((e) => console.warn('[Reindex] Template creation reindex failed:', e.message));

    res.status(201).json({
      ...newDoc,
      file_url: fileUrl,
    });
  } catch (err) {
    console.error("Error creating document from template:", err);
    res.status(500).json({ error: "Failed to create document from template" });
  }
});

// Explicit rename endpoint with server-side duplicate deduplication
router.patch('/:id/rename', requireAuth, async (req, res) => {
  try {
    const docId = req.params.id;
    const userId = req.user?.id;
    const { filename } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!filename || typeof filename !== 'string' || !filename.trim()) {
      return res.status(400).json({ error: "Document filename is required" });
    }

    const { data: doc, error: fetchError } = await supabaseStorage
      .from('user_documents')
      .select('id, user_id, filename')
      .eq('id', docId)
      .maybeSingle();

    if (fetchError || !doc) {
      return res.status(404).json({ error: "Document not found" });
    }
    if (doc.user_id && doc.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { data: otherDocs } = await supabaseStorage
      .from('user_documents')
      .select('filename')
      .eq('user_id', userId)
      .neq('id', docId);

    const existingFilenames = (otherDocs || []).map((d) => d.filename);
    const rawExt = path.extname(doc.filename || '');
    const currentExt = rawExt.toLowerCase() === '.txt' ? '' : rawExt;
    const cleanCandidate = filename.trim().replace(/\.txt$/i, "");
    const resolvedFilename = generateUniqueDocumentFilename(cleanCandidate, existingFilenames, currentExt);

    const { data: updatedDoc, error: updateError } = await supabaseStorage
      .from('user_documents')
      .update({ filename: resolvedFilename })
      .eq('id', docId)
      .select('*')
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      document: updatedDoc,
      filename: resolvedFilename,
    });
  } catch (err) {
    console.error("Error renaming document:", err);
    res.status(500).json({ error: "Failed to rename document" });
  }
});

export default router;

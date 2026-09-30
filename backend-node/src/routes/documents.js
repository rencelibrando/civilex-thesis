import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { requireAuth } from '../middleware/auth.js';

dotenv.config();

// Re-use native fetch if available, else import
const globalFetch = typeof fetch !== 'undefined' ? fetch : (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const router = express.Router();

// Service-role client for storage operations (bypasses RLS for uploads on behalf of users)
const supabaseStorage = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy'
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
      } catch (_) {}
    }

    const ext = path.extname(doc.filename);
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
          } catch (_) {}
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

    res.setHeader('Content-Type', resolvedMime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(doc.filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    return res.send(buffer);
  } catch (err) {
    console.error('[Document Serving] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error while retrieving document' });
  }
});

export default router;

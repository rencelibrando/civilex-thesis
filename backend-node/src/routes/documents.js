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

// Public URL base for browsers (Azure frontend cannot reach laptop localhost).
// Internal SUPABASE_URL stays localhost for fast backend->storage calls;
// SUPABASE_PUBLIC_URL (dev tunnel) is used for file_url stored/returned to clients.
const toPublicFileUrl = (url) => {
  if (!url) return url;
  const publicBase = (process.env.SUPABASE_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (!publicBase) return url;
  return url
    .replace('http://localhost:54321', publicBase)
    .replace('http://127.0.0.1:54321', publicBase);
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
    // Rewrite legacy localhost file_urls to tunnel-public URLs so Azure browsers can preview.
    const mapped = (data || []).map((d) => ({
      ...d,
      file_url: toPublicFileUrl(d.file_url),
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
    // Public URL for browsers: Azure frontend cannot reach laptop localhost.
    const fileUrl = toPublicFileUrl(internalFileUrl);

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

export default router;

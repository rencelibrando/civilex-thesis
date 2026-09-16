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
    res.json(data);
  } catch (err) {
    console.error("Error fetching documents:", err);
    res.status(500).json({ error: err.message });
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
      return res.status(500).json({ error: "Failed to upload to storage" });
    }

    // Get public URL
    const { data: publicUrlData } = supabaseStorage.storage
      .from('documents')
      .getPublicUrl(storagePath);

    const fileUrl = publicUrlData.publicUrl; 

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

    // Fire-and-forget: notify the Python extraction service
    globalFetch('http://localhost:8000/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_url: fileUrl, document_id: docId, filename: req.file.originalname })
    }).catch(err => console.error("Error pinging python service:", err));

    res.status(201).json({ id: docId, file_url: fileUrl, status: 'uploading' });
  } catch (err) {
    console.error("Error uploading document:", err);
    // Handle multer file type errors
    if (err.message && err.message.startsWith('Invalid file type')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

export default router;

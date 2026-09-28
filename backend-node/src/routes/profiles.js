import express from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { requireAuth } from '../middleware/auth.js';

dotenv.config();

const router = express.Router();

// Memory storage for avatar images (max 5MB, images only)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WEBP, GIF) are allowed'), false);
    }
  }
});

// Service-role client for admin operations (e.g. ensuring profile exists)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy'
);

// Get current user's profile
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data, error } = await req.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    
    // If profile doesn't exist yet, return a default skeleton populated from user_metadata
    if (!data) {
       return res.json({
         id: userId,
         full_name: req.user.user_metadata?.full_name || '',
         role: req.user.user_metadata?.role || '',
         organization: req.user.user_metadata?.organization || '',
         practice_area: req.user.user_metadata?.practice_area || '',
         phone_number: req.user.user_metadata?.phone_number || '',
         avatar_url: req.user.user_metadata?.avatar_url || null,
         notification_preferences: { email: true, push: false },
         theme_preferences: 'system',
         created_at: new Date().toISOString()
       });
    }

    res.json(data);
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ error: err.message });
  }
});

// Upload avatar for current user via service-role (guaranteed reliability)
router.post('/me/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const userId = req.user.id;
    const ext = req.file.originalname.split('.').pop() || 'png';
    const filePath = `${userId}/avatar.${ext}`;

    // Upload with supabaseAdmin (service role, always works)
    const { error: uploadError } = await supabaseAdmin.storage
      .from('avatars')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (uploadError) {
      console.error('Avatar storage upload error in backend:', uploadError);
      return res.status(500).json({ error: uploadError.message });
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('avatars')
      .getPublicUrl(filePath);

    const newAvatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Upsert into profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: userId, avatar_url: newAvatarUrl }, { onConflict: 'id' })
      .select()
      .maybeSingle();

    if (profileError) {
      console.error('Failed to update profile record:', profileError);
    }

    // Keep Supabase auth user metadata in sync
    try {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...req.user.user_metadata,
          avatar_url: newAvatarUrl
        }
      });
    } catch (metaErr) {
      console.warn('Could not sync user auth metadata:', metaErr);
    }

    return res.json({
      success: true,
      avatar_url: newAvatarUrl,
      profile: profile || { id: userId, avatar_url: newAvatarUrl }
    });
  } catch (err) {
    console.error('Error handling avatar upload:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Update (or create) user settings — upsert to handle missing profile rows
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      full_name,
      role,
      organization,
      practice_area,
      phone_number,
      avatar_url,
      notification_preferences,
      theme_preferences
    } = req.body;
    
    const updates = { id: userId };
    if (full_name !== undefined) updates.full_name = full_name;
    if (role !== undefined) updates.role = role;
    if (organization !== undefined) updates.organization = organization;
    if (practice_area !== undefined) updates.practice_area = practice_area;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (notification_preferences !== undefined) updates.notification_preferences = notification_preferences;
    if (theme_preferences !== undefined) updates.theme_preferences = theme_preferences;
    
    // Use upsert so it creates the row if missing
    const { data, error } = await req.supabase
      .from('profiles')
      .upsert(updates, { onConflict: 'id' })
      .select()
      .maybeSingle();

    if (error) throw error;

    // Sync auth user metadata if fields like full_name or avatar_url changed
    try {
      const metaUpdates = {};
      if (full_name !== undefined) metaUpdates.full_name = full_name;
      if (role !== undefined) metaUpdates.role = role;
      if (organization !== undefined) metaUpdates.organization = organization;
      if (practice_area !== undefined) metaUpdates.practice_area = practice_area;
      if (phone_number !== undefined) metaUpdates.phone_number = phone_number;
      if (avatar_url !== undefined) metaUpdates.avatar_url = avatar_url;

      if (Object.keys(metaUpdates).length > 0) {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          user_metadata: {
            ...req.user.user_metadata,
            ...metaUpdates
          }
        });
      }
    } catch (metaErr) {
      console.warn('Could not sync user auth metadata:', metaErr);
    }

    res.json(data);
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

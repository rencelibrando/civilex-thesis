import express from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';

dotenv.config();

const router = express.Router();

// High-speed In-Memory Avatar Cache for Client Latency Optimization
// Prevents redundant round-trips to Supabase storage on every page navigation
const avatarMemoryCache = new Map(); // userId -> { buffer, contentType, etag, expiresAt }
const AVATAR_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL
const MAX_AVATAR_CACHE_ENTRIES = 200;

function getCachedAvatar(userId) {
  const item = avatarMemoryCache.get(userId);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    avatarMemoryCache.delete(userId);
    return null;
  }
  return item;
}

function setCachedAvatar(userId, buffer, contentType, etag) {
  if (avatarMemoryCache.size >= MAX_AVATAR_CACHE_ENTRIES) {
    const oldestKey = avatarMemoryCache.keys().next().value;
    if (oldestKey) avatarMemoryCache.delete(oldestKey);
  }
  avatarMemoryCache.set(userId, {
    buffer,
    contentType,
    etag,
    expiresAt: Date.now() + AVATAR_CACHE_TTL_MS,
  });
}

function invalidateCachedAvatar(userId) {
  if (userId) avatarMemoryCache.delete(userId);
}

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
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

/**
 * Returns the public-facing Supabase base URL for generating externally
 * accessible asset links. Prefers SUPABASE_PUBLIC_URL (tunnel/production URL)
 * over SUPABASE_URL (which may be localhost in local-hosted setups).
 */
function getPublicSupabaseUrl() {
  return (
    process.env.SUPABASE_PUBLIC_URL ||
    process.env.SUPABASE_URL ||
    'http://localhost:54321'
  );
}

/**
 * Rewrites any localhost:54321 / 127.0.0.1:54321 references in a URL
 * to the public Supabase URL (tunnel). Returns the URL unchanged if
 * the public URL is also localhost.
 */
function rewriteToPublicUrl(url) {
  if (!url) return url;
  const publicUrl = getPublicSupabaseUrl();
  if (publicUrl.includes('localhost') || publicUrl.includes('127.0.0.1')) {
    return url; // No useful rewrite target available
  }
  return url
    .replace(/https?:\/\/localhost:54321/g, publicUrl.replace(/\/+$/, ''))
    .replace(/https?:\/\/127\.0\.0\.1:54321/g, publicUrl.replace(/\/+$/, ''));
}

// Ensure 'avatars' storage bucket exists and is public
async function ensureAvatarsBucket() {
  try {
    const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
    if (error) {
      console.warn('[Storage] listBuckets error:', error.message);
      return;
    }
    const bucket = buckets?.find((b) => b.name === 'avatars');
    if (!bucket) {
      await supabaseAdmin.storage.createBucket('avatars', {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      });
      console.log("[Storage] Created 'avatars' bucket with public access.");
    } else if (!bucket.public) {
      await supabaseAdmin.storage.updateBucket('avatars', { public: true });
      console.log("[Storage] Updated 'avatars' bucket to public access.");
    }
  } catch (e) {
    console.warn('[Storage] ensureAvatarsBucket note:', e.message);
  }
}
// Auto-verify bucket
ensureAvatarsBucket();

// Public route to retrieve avatar bytes directly (bypasses browser CORS & storage RLS in production)
router.get('/avatar/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || typeof userId !== 'string' || userId.includes('..') || userId.includes('/')) {
      return res.status(400).send('Invalid user ID');
    }

    // Step 1: Check high-speed in-memory avatar cache (<1ms response time)
    const cached = getCachedAvatar(userId);
    if (cached) {
      if (req.headers['if-none-match'] === cached.etag) {
        return res.status(304).end();
      }
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('ETag', cached.etag);
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.send(cached.buffer);
    }

    // Step 2: Try finding the file in Supabase storage via service-role
    const { data: files } = await supabaseAdmin.storage
      .from('avatars')
      .list(userId, { limit: 5 });

    if (files && files.length > 0) {
      const avatarFile = files.find(f => f.name.startsWith('avatar.')) || files[0];
      if (avatarFile) {
        const filePath = `${userId}/${avatarFile.name}`;
        const { data: blob, error: downloadError } = await supabaseAdmin.storage
          .from('avatars')
          .download(filePath);

        if (!downloadError && blob) {
          const buffer = Buffer.from(await blob.arrayBuffer());
          const contentType = blob.type || 'image/png';
          const etag = `"${crypto.createHash('md5').update(buffer).digest('hex')}"`;

          // Store in fast memory cache
          setCachedAvatar(userId, buffer, contentType, etag);

          if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
          }

          res.setHeader('Content-Type', contentType);
          res.setHeader('ETag', etag);
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
          return res.send(buffer);
        }
      }
    }

    // Check profiles table for external avatar URL (e.g. Google OAuth)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.avatar_url && !profile.avatar_url.includes('localhost') && !profile.avatar_url.includes('127.0.0.1')) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.redirect(302, profile.avatar_url);
    }

    // Check auth user metadata
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      const metaUrl = authUser?.user?.user_metadata?.avatar_url || authUser?.user?.user_metadata?.picture;
      if (metaUrl && !metaUrl.includes('localhost') && !metaUrl.includes('127.0.0.1')) {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        return res.redirect(302, metaUrl);
      }
    } catch (_) { }

    return res.status(404).send('Avatar not found');
  } catch (err) {
    console.error('Error streaming avatar:', err);
    return res.status(500).send('Error streaming avatar');
  }
});

// Get current user's profile
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    let { data, error } = await req.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;

    const metaAvatar =
      req.user.user_metadata?.avatar_url ||
      req.user.user_metadata?.picture ||
      null;

    // If profile doesn't exist yet, auto-create and persist it for this authenticated user
    if (!data) {
      const initialProfile = {
        id: userId,
        full_name: req.user.user_metadata?.full_name || '',
        role: req.user.user_metadata?.role || '',
        organization: req.user.user_metadata?.organization || '',
        practice_area: req.user.user_metadata?.practice_area || '',
        phone_number: req.user.user_metadata?.phone_number || '',
        avatar_url: metaAvatar,
        notification_preferences: { email: true, push: false },
        theme_preferences: 'system',
      };

      try {
        const { data: created, error: createError } = await supabaseAdmin
          .from('profiles')
          .upsert(initialProfile, { onConflict: 'id' })
          .select()
          .maybeSingle();

        if (!createError && created) {
          data = created;
        } else {
          data = { ...initialProfile, created_at: new Date().toISOString() };
        }
      } catch (upsertErr) {
        data = { ...initialProfile, created_at: new Date().toISOString() };
      }
    }

    // Attach verified email from authenticated user token
    if (data) {
      data.email = req.user.email || '';
    }

    // If profile exists but avatar_url is empty/null, fall back to auth metadata
    if (data && !data.avatar_url && metaAvatar) {
      data.avatar_url = metaAvatar;
    }

    // If avatar_url points to localhost:54321, rewrite using SUPABASE_PUBLIC_URL (tunnel)
    if (data?.avatar_url && (data.avatar_url.includes('localhost:54321') || data.avatar_url.includes('127.0.0.1:54321'))) {
      data.avatar_url = rewriteToPublicUrl(data.avatar_url);
    }

    // Strictly prohibit caching of user-private profile responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
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

    await ensureAvatarsBucket();

    const userId = req.user.id;
    const ext = req.file.originalname.split('.').pop() || 'png';
    const filePath = `${userId}/avatar.${ext}`;

    // Invalidate any existing cached avatar in memory
    invalidateCachedAvatar(userId);

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

    let newAvatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Rewrite localhost URLs to use SUPABASE_PUBLIC_URL (tunnel) for production accessibility
    if (newAvatarUrl.includes('localhost:54321') || newAvatarUrl.includes('127.0.0.1:54321')) {
      newAvatarUrl = rewriteToPublicUrl(newAvatarUrl);
    }

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

    // Invalidate avatar cache if avatar is being changed or deleted
    if (avatar_url !== undefined) {
      invalidateCachedAvatar(userId);
    }

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

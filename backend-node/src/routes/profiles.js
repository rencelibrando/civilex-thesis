import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { requireAuth } from '../middleware/auth.js';

dotenv.config();

const router = express.Router();

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

    res.json(data);
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

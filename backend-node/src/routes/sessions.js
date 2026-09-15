import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { requireAuth } from '../middleware/auth.js';

dotenv.config();

const router = express.Router();

// Get all chat sessions for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data, error } = await req.supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Error fetching sessions:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create a new chat session
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title } = req.body;
    
    const { data, error } = await req.supabase
      .from('chat_sessions')
      .insert({ user_id: userId, title: title || 'New Chat' })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error("Error creating session:", err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch all messages for a specific session
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    // Check if the session exists and belongs to the user
    const { data: session, error: sessionError } = await req.supabase
      .from('chat_sessions')
      .select('user_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session || session.user_id !== req.user.id) {
       return res.status(403).json({ error: 'Unauthorized or session not found' });
    }

    const { data, error } = await req.supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: err.message });
  }
});

// Append a new message to a session (manual add before/after streaming)
router.post('/:id/messages', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { role, content, citations } = req.body;
    
    // Check if the session exists and belongs to the user
    const { data: session, error: sessionError } = await req.supabase
      .from('chat_sessions')
      .select('user_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session || session.user_id !== req.user.id) {
       return res.status(403).json({ error: 'Unauthorized or session not found' });
    }

    const { data, error } = await req.supabase
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role,
        content,
        citations
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error("Error appending message:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

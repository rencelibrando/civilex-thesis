import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("[AuthMiddleware] WARNING: Supabase credentials are missing from .env");
}

const defaultClient = createClient(supabaseUrl || 'http://localhost:54321', supabaseAnonKey || 'dummy');

/**
 * Hardened Authentication Middleware for Backend Gateway
 * Validates JWT Bearer tokens against Supabase Auth service.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        code: 'MISSING_OR_INVALID_AUTH_HEADER',
        message: 'A valid Bearer authentication token is required to access this resource.'
      });
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        code: 'EMPTY_BEARER_TOKEN',
        message: 'Bearer token string cannot be empty.'
      });
    }

    const { data: { user }, error } = await defaultClient.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'Unauthorized',
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Session token is invalid, expired, or revoked.',
        details: error?.message
      });
    }

    // Create a request-scoped authenticated client for RLS
    req.supabase = createClient(
      supabaseUrl || 'http://localhost:54321',
      supabaseAnonKey || 'dummy',
      { global: { headers: { Authorization: authHeader } } }
    );

    req.user = user;
    next();
  } catch (err) {
    console.error('[AuthMiddleware] Verification exception:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An error occurred while validating authentication credentials.'
    });
  }
};

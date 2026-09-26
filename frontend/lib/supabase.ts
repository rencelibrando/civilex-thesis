import { createClient } from "@supabase/supabase-js";
import {
  AUTH_STORAGE_KEYS,
  isSessionExpired,
  clearAllAuthStorage,
  updateSessionActivity,
} from "./auth-storage";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: AUTH_STORAGE_KEYS.SESSION,
  },
});

export async function getValidSession() {
  try {
    // Check 15-day expiry policy
    if (isSessionExpired()) {
      await signOutUser("Your 15-day session lifetime has expired. Please sign in again.");
      return null;
    }

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      return null;
    }

    // Touch session activity
    updateSessionActivity();
    return session;
  } catch (err) {
    console.error("[Supabase Auth] Error fetching valid session:", err);
    return null;
  }
}

/**
 * Hardened sign out helper that clears Supabase session and local storage keys.
 */
export async function signOutUser(reason?: string) {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("[Supabase Auth] Error during auth.signOut:", err);
  } finally {
    clearAllAuthStorage(reason);
  }
}

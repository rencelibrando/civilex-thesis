/**
 * CIVIL-LEX Authentication & Session Security Utilities
 * Enforces standard security practices, browser key storage management,
 * 15-day session lifetime policy, and login brute-force throttling.
 */

export const SESSION_MAX_AGE_DAYS = 15;
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000; // 15 days in milliseconds

export const AUTH_STORAGE_KEYS = {
  SESSION: "civilex_auth_session",
  METADATA: "civilex_session_meta",
  PROFILE: "civilex_user_profile",
  THROTTLE: "civilex_auth_throttle",
  LOGOUT_REASON: "civilex_logout_reason",
  JUST_LOGGED_OUT: "civilex_just_logged_out",
} as const;

export interface CachedUserProfile {
  id: string;
  email?: string;
  full_name: string;
  role: string;
  organization: string;
  practice_area?: string;
  phone_number?: string;
  avatar_url: string | null;
  updated_at?: string;
  cachedAt: number;
}

export interface SessionMetadata {
  loginTimestamp: number;
  lastActiveTimestamp: number;
  maxAgeDays: number;
  rememberMe: boolean;
  userEmail?: string;
}

export interface ThrottleState {
  attempts: number;
  lockoutUntil: number | null;
}

/**
 * Persists session security metadata when a user signs in.
 */
export function recordSessionLogin(email?: string, rememberMe = true): SessionMetadata {
  if (typeof window === "undefined") {
    return {
      loginTimestamp: Date.now(),
      lastActiveTimestamp: Date.now(),
      maxAgeDays: SESSION_MAX_AGE_DAYS,
      rememberMe,
      userEmail: email,
    };
  }

  // Clear any logout flags
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEYS.JUST_LOGGED_OUT);
  } catch {
    // ignore
  }

  const meta: SessionMetadata = {
    loginTimestamp: Date.now(),
    lastActiveTimestamp: Date.now(),
    maxAgeDays: SESSION_MAX_AGE_DAYS,
    rememberMe,
    userEmail: email,
  };

  try {
    localStorage.setItem(AUTH_STORAGE_KEYS.METADATA, JSON.stringify(meta));
  } catch (err) {
    console.warn("[AuthSecurity] Failed to persist session metadata:", err);
  }

  return meta;
}

/**
 * Retrieves the stored session metadata.
 */
export function getSessionMetadata(): SessionMetadata | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEYS.METADATA);
    if (!raw) return null;
    return JSON.parse(raw) as SessionMetadata;
  } catch {
    return null;
  }
}

/**
 * Updates the last active timestamp to keep track of active usage.
 */
export function updateSessionActivity(): void {
  if (typeof window === "undefined") return;

  try {
    const meta = getSessionMetadata();
    if (meta) {
      meta.lastActiveTimestamp = Date.now();
      localStorage.setItem(AUTH_STORAGE_KEYS.METADATA, JSON.stringify(meta));
    }
  } catch (err) {
    console.warn("[AuthSecurity] Failed to update session activity:", err);
  }
}

/**
 * Checks if the session has exceeded the 15-day lifetime limit.
 */
export function isSessionExpired(): boolean {
  if (typeof window === "undefined") return false;

  const meta = getSessionMetadata();
  if (!meta) {
    return false;
  }

  const now = Date.now();
  const elapsed = now - meta.loginTimestamp;
  return elapsed > SESSION_MAX_AGE_MS;
}

/**
 * Clears all authentication tokens, session data, and security metadata.
 */
export function clearAllAuthStorage(reason?: string): void {
  if (typeof window === "undefined") return;

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key === AUTH_STORAGE_KEYS.SESSION ||
          key === AUTH_STORAGE_KEYS.METADATA ||
          key === AUTH_STORAGE_KEYS.PROFILE ||
          key.startsWith(`${AUTH_STORAGE_KEYS.PROFILE}_`) ||
          key.startsWith("civilex_user_profile") ||
          key.startsWith("civilex_auth_session") ||
          key.startsWith("sb-") ||
          key.includes("supabase"))
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Clear session storage auth keys comprehensively
    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (
        key &&
        (key === AUTH_STORAGE_KEYS.SESSION ||
          key === AUTH_STORAGE_KEYS.METADATA ||
          key === AUTH_STORAGE_KEYS.PROFILE ||
          key.startsWith(`${AUTH_STORAGE_KEYS.PROFILE}_`) ||
          key.startsWith("civilex_user_profile") ||
          key.startsWith("civilex_auth_session") ||
          key.startsWith("sb-") ||
          key.includes("supabase"))
      ) {
        sessionKeysToRemove.push(key);
      }
    }
    sessionKeysToRemove.forEach((k) => sessionStorage.removeItem(k));

    sessionStorage.setItem(AUTH_STORAGE_KEYS.JUST_LOGGED_OUT, "true");

    if (reason) {
      sessionStorage.setItem(AUTH_STORAGE_KEYS.LOGOUT_REASON, reason);
    }
  } catch (err) {
    console.warn("[AuthSecurity] Error clearing storage:", err);
  }
}

/**
 * Checks and consumes the just-logged-out flag.
 */
export function checkAndConsumeJustLoggedOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const isLoggedOut = sessionStorage.getItem(AUTH_STORAGE_KEYS.JUST_LOGGED_OUT) === "true";
    if (isLoggedOut) {
      sessionStorage.removeItem(AUTH_STORAGE_KEYS.JUST_LOGGED_OUT);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Retrieves and clears the logout reason message (e.g. for displaying on login page).
 */
export function consumeLogoutReason(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const reason = sessionStorage.getItem(AUTH_STORAGE_KEYS.LOGOUT_REASON);
    if (reason) {
      sessionStorage.removeItem(AUTH_STORAGE_KEYS.LOGOUT_REASON);
      return reason;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Brute-Force Throttling & Rate-Limiting Management
 */
export function getThrottleState(): ThrottleState {
  if (typeof window === "undefined") return { attempts: 0, lockoutUntil: null };

  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEYS.THROTTLE);
    if (!raw) return { attempts: 0, lockoutUntil: null };
    const state = JSON.parse(raw) as ThrottleState;

    if (state.lockoutUntil && Date.now() >= state.lockoutUntil) {
      return { attempts: 0, lockoutUntil: null };
    }

    return state;
  } catch {
    return { attempts: 0, lockoutUntil: null };
  }
}

export function recordFailedLoginAttempt(): {
  isLocked: boolean;
  lockoutSeconds: number;
  attempts: number;
} {
  if (typeof window === "undefined") return { isLocked: false, lockoutSeconds: 0, attempts: 1 };

  const current = getThrottleState();
  const attempts = current.attempts + 1;
  let lockoutUntil: number | null = null;
  let lockoutSeconds = 0;

  if (attempts >= 10) {
    lockoutSeconds = 300;
    lockoutUntil = Date.now() + lockoutSeconds * 1000;
  } else if (attempts >= 8) {
    lockoutSeconds = 60;
    lockoutUntil = Date.now() + lockoutSeconds * 1000;
  } else if (attempts >= 5) {
    lockoutSeconds = 30;
    lockoutUntil = Date.now() + lockoutSeconds * 1000;
  }

  const newState: ThrottleState = {
    attempts,
    lockoutUntil,
  };

  try {
    localStorage.setItem(AUTH_STORAGE_KEYS.THROTTLE, JSON.stringify(newState));
  } catch (err) {
    console.warn("[AuthSecurity] Failed to persist throttle state:", err);
  }

  return {
    isLocked: lockoutUntil !== null,
    lockoutSeconds,
    attempts,
  };
}

export function resetThrottleState(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEYS.THROTTLE);
  } catch {
    // ignore
  }
}

export function getRemainingLockoutSeconds(): number {
  const state = getThrottleState();
  if (!state.lockoutUntil) return 0;
  const remaining = Math.ceil((state.lockoutUntil - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

/**
 * Retrieves the locally cached user profile for instant 0ms rendering on client devices.
 * Strictly verifies the requested userId to prevent cross-account profile leakage.
 */
export function getCachedProfile(userId?: string): CachedUserProfile | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const key = `${AUTH_STORAGE_KEYS.PROFILE}_${userId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUserProfile;
    // Strict verification: ensure the cached profile actually belongs to this userId
    if (!parsed || parsed.id !== userId) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persists user profile to client device storage, strictly namespaced by userId.
 */
export function saveCachedProfile(userId: string, data: Partial<CachedUserProfile>): CachedUserProfile {
  if (!userId) {
    throw new Error("userId is required to persist profile cache");
  }

  const current = getCachedProfile(userId) || {
    id: userId,
    full_name: "",
    role: "",
    organization: "",
    avatar_url: null,
    cachedAt: 0,
  };

  const updated: CachedUserProfile = {
    ...current,
    ...data,
    id: userId,
    cachedAt: Date.now(),
  };

  if (typeof window !== "undefined") {
    try {
      const userKey = `${AUTH_STORAGE_KEYS.PROFILE}_${userId}`;
      localStorage.setItem(userKey, JSON.stringify(updated));
      // Purge any legacy un-namespaced profile key so it never leaks across accounts
      localStorage.removeItem(AUTH_STORAGE_KEYS.PROFILE);
    } catch (err) {
      console.warn("[AuthSecurity] Failed to persist profile cache:", err);
    }
  }

  return updated;
}

/**
 * Removes cached user profile from client storage.
 */
export function clearCachedProfile(userId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      localStorage.removeItem(`${AUTH_STORAGE_KEYS.PROFILE}_${userId}`);
    }
    // Also remove any un-namespaced profile key
    localStorage.removeItem(AUTH_STORAGE_KEYS.PROFILE);
  } catch (_) {}
}


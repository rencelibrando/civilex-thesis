/**
 * CIVIL-LEX friendly authentication error mapping.
 *
 * Supabase-js surfaces network outages as a bare `TypeError: Failed to fetch`
 * (browsers intentionally hide details). That message is useless on the login
 * screen, especially for the Azure-hosted frontend where a bad
 * `NEXT_PUBLIC_SUPABASE_URL` build arg also looks like "Failed to fetch".
 *
 * This module maps raw errors into user-actionable messages and machine
 * readable `AuthErrorKind` values so the UI can render:
 * - offline (browser has no network)
 * - auth-down (Supabase Auth unreachable)
 * - backend-down (CIVIL-LEX backend-node unreachable)
 * - credentials / email-not-confirmed / rate-limited / unknown
 */

export type AuthErrorKind =
  | "offline"
  | "auth-down"
  | "backend-down"
  | "credentials"
  | "email-not-confirmed"
  | "rate-limited"
  | "unknown";

export interface MappedAuthError {
  message: string;
  kind: AuthErrorKind;
}

export interface ServiceHealth {
  supabaseReachable: boolean | null;
  backendReachable: boolean | null;
  /** True when a production (non-localhost) build points at localhost/internal URLs. */
  isProductionMisconfigured: boolean;
  supabaseUrl: string;
}

const NETWORK_MESSAGE_PATTERN =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|network error|ERR_INTERNET|ERR_NETWORK|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout|connection refused|temporarily unavailable/i;

export function isBrowserOffline(): boolean {
  if (typeof navigator !== "undefined" && "onLine" in navigator) {
    return navigator.onLine === false;
  }
  return false;
}

export function isNetworkFetchErrorMessage(message: string): boolean {
  if (!message) return false;
  return NETWORK_MESSAGE_PATTERN.test(message);
}

function getSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321"
  ).replace(/\/+$/, "");
}

/**
 * Detects the Azure "localhost baked into production build" footgun.
 * NEXT_PUBLIC_* values are inlined at `next build` time, so a build without
 * proper --build-arg ends up calling http://localhost:54321 from users' browsers.
 */
export function isProductionSupabaseMisconfigured(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname;
  const isProdHost = hostname !== "localhost" && hostname !== "127.0.0.1";
  if (!isProdHost) return false;
  const url = getSupabaseUrl();
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.startsWith("http://backend") ||
    url.includes("dummy-anon-key") ||
    url === ""
  );
}

/**
 * Maps a Supabase `signInWithPassword` style error object
 * (`{ message, code }`) to a friendly message. Preserves actionable
 * Supabase messages (bad credentials, unconfirmed email) verbatim.
 */
export function mapSupabaseSignInError(error: {
  message?: string;
  code?: string | null;
  status?: number;
}): MappedAuthError {
  const raw = (error?.message || "").trim();
  const lower = raw.toLowerCase();

  if (isBrowserOffline()) {
    return {
      kind: "offline",
      message:
        "You appear to be offline. Please check your internet connection and try again.",
    };
  }

  if (!raw || isNetworkFetchErrorMessage(raw)) {
    return {
      kind: "auth-down",
      message:
        "Authentication server is offline or unreachable. Please try again in a moment. If this persists, contact support.",
    };
  }

  if (lower.includes("email not confirmed") || lower.includes("email not verified")) {
    return { kind: "email-not-confirmed", message: raw };
  }

  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid email or password") ||
    lower.includes("invalid password") ||
    lower.includes("user not found") ||
    lower.includes("no user found") ||
    lower.includes("email/password") ||
    error?.code === "invalid_credentials"
  ) {
    return {
      kind: "credentials",
      // Keep Supabase wording short but familiar; fall back to generic.
      message: raw || "Invalid email or password. Please check your credentials and try again.",
    };
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("over_email_send_rate_limit") ||
    lower.includes("email rate limit") ||
    error?.code === "over_request_rate_limit"
  ) {
    return {
      kind: "rate-limited",
      message: raw || "Too many attempts. Please wait a moment and try again.",
    };
  }

  return { kind: "unknown", message: raw || "Sign-in failed. Please try again." };
}

/**
 * Maps a thrown exception (network TypeError, AbortError, unexpected) to a
 * friendly message. Network failures become `auth-down`, not raw "Failed to fetch".
 */
export function mapAuthException(err: unknown): MappedAuthError {
  if (isBrowserOffline()) {
    return {
      kind: "offline",
      message:
        "You appear to be offline. Please check your internet connection and try again.",
    };
  }

  const raw = err instanceof Error ? err.message.trim() : String(err ?? "").trim();

  if (!raw || isNetworkFetchErrorMessage(raw) || (err instanceof TypeError && raw.length < 60)) {
    // TypeError with short/opaque message is almost always a CORS / DNS /
    // connection-refused / Supabase-paused fetch failure.
    if (isProductionSupabaseMisconfigured()) {
      return {
        kind: "auth-down",
        message:
          "Sign-in service is temporarily unavailable (server configuration issue). Please try again later or contact support.",
      };
    }
    return {
      kind: "auth-down",
      message:
        "Authentication server is offline or unreachable. Please try again in a moment. If this persists, contact support.",
    };
  }

  return { kind: "unknown", message: raw || "An unexpected authentication error occurred." };
}

/**
 * Refines a generic outage into auth-down vs backend-down by probing both
 * services with a short timeout. Any HTTP response (even 4xx) counts as
 * "reachable" - only a thrown network error / timeout counts as down.
 */
export async function probeServiceHealth(timeoutMs = 5000): Promise<ServiceHealth> {
  const supabaseUrl = getSupabaseUrl();
  const isProductionMisconfigured = isProductionSupabaseMisconfigured();

  if (typeof window === "undefined") {
    return {
      supabaseReachable: null,
      backendReachable: null,
      isProductionMisconfigured: false,
      supabaseUrl,
    };
  }

  // Lazy import avoids a hard dependency cycle (config does not import this file).
  const { apiUrl } = await import("./config");

  const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<boolean | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
      });
      // Any HTTP response proves the host is up (auth may still 401 without key).
      void res;
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const supabaseHealthUrl = `${supabaseUrl}/auth/v1/health`;
  // Relative URL resolves against the Azure frontend origin and hits the
  // Next.js rewrite proxy -> backend-node /health (avoids CORS entirely).
  const backendHealthUrl = apiUrl("/health");

  const [supabaseReachable, backendReachable] = await Promise.all([
    isProductionMisconfigured
      ? Promise.resolve(false)
      : fetchWithTimeout(supabaseHealthUrl),
    fetchWithTimeout(backendHealthUrl),
  ]);

  return {
    supabaseReachable,
    backendReachable,
    isProductionMisconfigured,
    supabaseUrl,
  };
}

/**
 * Builds the final outage message once health probes have completed.
 * Login only strictly requires Supabase, so Supabase-down takes precedence;
 * backend-down alone is reported as the app server being offline.
 */
export function refineOutageMessage(health: ServiceHealth): MappedAuthError {
  if (health.isProductionMisconfigured) {
    return {
      kind: "auth-down",
      message:
        "Sign-in service is temporarily unavailable (server configuration issue). Please try again later or contact support.",
    };
  }
  if (health.supabaseReachable === false && health.backendReachable === false) {
    return {
      kind: "auth-down",
      message:
        "Servers are offline. Both the authentication service and the app server are unreachable. Please try again later.",
    };
  }
  if (health.supabaseReachable === false) {
    return {
      kind: "auth-down",
      message:
        "Authentication server is offline or unreachable. Your account details could not be verified. Please try again later.",
    };
  }
  if (health.backendReachable === false) {
    return {
      kind: "backend-down",
      message:
        "App server is offline or unreachable. Please try again in a moment. If this persists, contact support.",
    };
  }
  // Both reachable (transient blip) or unknown (probes unsupported).
  return {
    kind: "auth-down",
    message:
      "Connection to the authentication server was interrupted. Please check your connection and try again.",
  };
}

/**
 * True for outage kinds that must NOT count toward brute-force lockout.
 * Locking a user out because Supabase / the network is down is a bug.
 */
export function isOutageKind(kind: AuthErrorKind): boolean {
  return kind === "offline" || kind === "auth-down" || kind === "backend-down";
}

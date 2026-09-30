/**
 * Application Runtime Configuration
 *
 * In local development, defaults to http://localhost:4000.
 * In production browser, routes via Next.js same-origin proxy ('') unless a valid external
 * domain is configured, eliminating the 4-second localhost connection timeout and CORS overhead.
 */

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    const configured =
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL;

    // In production browser (non-localhost):
    if (!isLocalhost) {
      // If no URL configured, or configured points to localhost/internal docker name,
      // return empty string to use same-origin relative URLs (/api/...) proxied by Next.js.
      if (
        !configured ||
        configured.includes("localhost") ||
        configured.includes("127.0.0.1") ||
        configured.startsWith("http://backend") ||
        configured.includes("devtunnels.ms")
      ) {
        return "";
      }

      // Upgrade/prevent mixed content if frontend is HTTPS but backend was set to HTTP
      if (window.location.protocol === "https:" && configured.startsWith("http://")) {
        return "";
      }

      return configured.replace(/\/+$/, "");
    }

    // In local development browser:
    return (configured || "http://localhost:4000").replace(/\/+$/, "");
  }

  // Server-side (Node / SSR runtime)
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:4000"
  ).replace(/\/+$/, "");
}

export const BACKEND_URL =
  typeof window !== "undefined"
    ? getApiBaseUrl()
    : (
        process.env.BACKEND_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        "http://localhost:4000"
      ).replace(/\/+$/, "");

/**
 * Returns a fully resolved API URL for browser or server fetch calls.
 */
export function apiUrl(endpoint: string): string {
  const clean = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const base = getApiBaseUrl();
  return base ? `${base}${clean}` : clean;
}

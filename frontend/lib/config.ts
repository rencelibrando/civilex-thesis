/**
 * Application Runtime Configuration
 *
 * In local development, defaults to http://localhost:4000.
 * When deployed to Azure, configured via NEXT_PUBLIC_API_URL or NEXT_PUBLIC_BACKEND_URL.
 */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4000";

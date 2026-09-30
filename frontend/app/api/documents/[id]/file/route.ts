import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return new Response("Missing document ID", { status: 400 });
    }

    const backendBase = (
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4000"
    ).replace(/\/+$/, "");

    const searchParams = request.nextUrl.searchParams.toString();
    const query = searchParams ? `?${searchParams}` : "";
    const targetUrl = `${backendBase}/api/documents/${id}/file${query}`;

    // Server-side fetch passes dev tunnel anti-phishing bypass header
    const response = await fetch(targetUrl, {
      headers: {
        "X-Tunnel-Skip-AntiPhishing-Page": "true",
        Accept: "*/*",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return new Response(errText || "Document not found", {
        status: response.status,
      });
    }

    const headers = new Headers();
    const contentType = response.headers.get("Content-Type") || "application/pdf";
    const contentDisposition = response.headers.get("Content-Disposition") || "inline";
    const cacheControl = response.headers.get("Cache-Control") || "public, max-age=3600";
    const contentLength = response.headers.get("Content-Length");

    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", contentDisposition);
    headers.set("Cache-Control", cacheControl);
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch (err: any) {
    console.error("[Next.js Document Proxy Error]:", err);
    return new Response("Failed to retrieve document preview", { status: 500 });
  }
}

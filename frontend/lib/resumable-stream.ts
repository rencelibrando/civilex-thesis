export type StreamEvent = {
  type: string;
  stage?: string;
  message?: string;
  text?: string;
  count?: number;
  queue_position?: number;
  job_id?: string;
  status?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export type StreamOutcome = "completed" | "cancelled" | "error" | "expired";

export interface ResumableStreamOptions {
  backendUrl: string;
  lockName?: string;
  start?: (signal: AbortSignal) => Promise<Response>;
  resume?: { jobId: string; after: number };
  getToken: () => Promise<string>;
  onEvent: (event: StreamEvent) => void;
  signal: AbortSignal;
}

const STALL_MS = 45000;
const RESUME_STALE_MS = 5000;
const MAX_RETRIES = 8;

async function executeStream(options: ResumableStreamOptions): Promise<StreamOutcome> {
  const { backendUrl, start, resume, getToken, onEvent, signal } = options;

  let currentJobId = resume?.jobId || null;
  let lastSeq = resume?.after !== undefined ? resume.after : -1;
  let isFirstAttempt = !resume;
  let retryCount = 0;

  // Single active connection controller linked to user cancel signal
  let connectionAbortController: AbortController | null = null;
  let lastByteTime = Date.now();

  const handleUserAbort = () => {
    if (connectionAbortController && !connectionAbortController.signal.aborted) {
      connectionAbortController.abort("User cancelled");
    }
  };

  signal.addEventListener("abort", handleUserAbort, { once: true });

  const abortCurrentConnection = (reason: string) => {
    if (connectionAbortController && !connectionAbortController.signal.aborted) {
      try {
        connectionAbortController.abort(reason);
      } catch {}
    }
  };

  // Visibility and background wake listeners: detect silent socket freezes on iOS
  const handleLifecyclePoke = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      if (currentJobId && Date.now() - lastByteTime > RESUME_STALE_MS) {
        // Socket likely frozen during background sleep; abort connection to trigger instant resume
        abortCurrentConnection("Foreground wake stale socket");
      }
    }
  };

  if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", handleLifecyclePoke);
    window.addEventListener("pageshow", handleLifecyclePoke);
    window.addEventListener("online", handleLifecyclePoke);
  }

  try {
    while (!signal.aborted) {
      connectionAbortController = new AbortController();
      let streamResponse: Response | null = null;

      try {
        if (isFirstAttempt && start) {
          streamResponse = await start(connectionAbortController.signal);
          isFirstAttempt = false;
        } else {
          if (!currentJobId) {
            return "expired";
          }
          const token = await getToken();
          const resumeUrl = `${backendUrl}/api/chat/stream/${currentJobId}?after=${lastSeq}`;
          streamResponse = await fetch(resumeUrl, {
            method: "GET",
            signal: connectionAbortController.signal,
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              "Last-Event-ID": String(lastSeq),
              "X-Tunnel-Skip-AntiPhishing-Page": "true",
            },
          });
        }

        if (!streamResponse.ok) {
          if (streamResponse.status === 404 && currentJobId) {
            return "expired";
          }
          throw new Error(`HTTP ${streamResponse.status}: ${streamResponse.statusText}`);
        }

        if (!streamResponse.body) {
          throw new Error("No response body received from stream");
        }

        // Connection established, reset exponential backoff counter
        retryCount = 0;
        lastByteTime = Date.now();

        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Client watchdog: abort hung connection if visible but no data/ping arrived
        const watchdogTimer = setInterval(() => {
          const isVisible = typeof document === "undefined" || document.visibilityState === "visible";
          if (isVisible && Date.now() - lastByteTime > STALL_MS) {
            abortCurrentConnection("Stream watchdog timeout");
          }
        }, 5000);

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            lastByteTime = Date.now();
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() || "";

            for (const rawChunk of chunks) {
              const lines = rawChunk.split("\n");
              let currentId: number | null = null;
              let dataContent = "";

              for (const line of lines) {
                if (line.startsWith(":")) {
                  // Keepalive ping
                  continue;
                }
                if (line.startsWith("id: ")) {
                  const parsed = parseInt(line.slice(4).trim(), 10);
                  if (!isNaN(parsed)) {
                    currentId = parsed;
                  }
                } else if (line.startsWith("data: ")) {
                  dataContent = line.slice(6).trim();
                }
              }

              // Deduplicate events already processed
              if (currentId !== null && currentId <= lastSeq) {
                continue;
              }

              if (currentId !== null) {
                lastSeq = currentId;
              }

              if (dataContent) {
                try {
                  const parsedEvent: StreamEvent = JSON.parse(dataContent);

                  if (parsedEvent.type === "job" && parsedEvent.job_id) {
                    currentJobId = parsedEvent.job_id;
                  }

                  if (parsedEvent.type === "end") {
                    const finalStatus = parsedEvent.status;
                    if (finalStatus === "cancelled") return "cancelled";
                    if (finalStatus === "error") return "error";
                    return "completed";
                  }

                  onEvent(parsedEvent);
                } catch (parseErr) {
                  console.error("SSE parse error", parseErr, dataContent);
                }
              }
            }
          }
        } finally {
          clearInterval(watchdogTimer);
          try {
            reader.releaseLock();
          } catch {}
        }
      } catch (connErr) {
        if (signal.aborted) {
          return "cancelled";
        }

        // If we haven't acquired a jobId yet on the initial request, error immediately
        if (!currentJobId) {
          throw connErr;
        }

        retryCount++;
        if (retryCount > MAX_RETRIES) {
          return "expired";
        }

        // Exponential backoff with jitter (250ms -> 8s)
        const delay = Math.min(250 * Math.pow(1.8, retryCount - 1), 8000) + Math.random() * 200;
        await new Promise((res) => {
          const timeoutId = setTimeout(res, delay);
          const cancelWait = () => {
            clearTimeout(timeoutId);
            res(null);
          };
          signal.addEventListener("abort", cancelWait, { once: true });
        });
      }
    }

    return "cancelled";
  } finally {
    signal.removeEventListener("abort", handleUserAbort);
    if (typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", handleLifecyclePoke);
      window.removeEventListener("pageshow", handleLifecyclePoke);
      window.removeEventListener("online", handleLifecyclePoke);
    }
  }
}

export async function runResumableStream(
  options: ResumableStreamOptions
): Promise<StreamOutcome> {
  // Web Locks API desktop hardening: prevents Chromium Energy/Memory Saver tab freeze
  if (
    options.lockName &&
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    typeof navigator.locks?.request === "function"
  ) {
    return navigator.locks.request(options.lockName, () => executeStream(options));
  }
  return executeStream(options);
}

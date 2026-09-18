import { useState, useEffect, useRef } from "react";

export interface UseStreamingCitationsResult<T> {
  visibleCitations: T[];
  visibleCount: number;
  totalCount: number;
  isStreamingCitations: boolean;
}

/**
 * Hook to smoothly stream/stagger the reveal of citations one-by-one while the
 * model is streaming its answer, rather than popping all citations into the UI at once.
 *
 * @param citations Sorted array of citations (highest percentage on top)
 * @param isStreaming Boolean indicating if the assistant is actively streaming/typing
 * @param intervalMs Milliseconds between revealing each subsequent citation (defaults to 240ms)
 */
export function useStreamingCitations<T = any>(
  citations: T[],
  isStreaming: boolean,
  intervalMs = 240
): UseStreamingCitationsResult<T> {
  const [visibleCount, setVisibleCount] = useState<number>(() =>
    isStreaming ? 0 : citations.length
  );
  const streamIdRef = useRef<number>(0);
  const prevLengthRef = useRef<number>(isStreaming ? 0 : citations.length);
  const wasStreamingRef = useRef<boolean>(isStreaming);
  const visibleCountRef = useRef<number>(visibleCount);

  visibleCountRef.current = visibleCount;

  useEffect(() => {
    // If not streaming (e.g. streaming finished, or viewing historical chat sessions),
    // immediately show all citations without any delay.
    if (!isStreaming) {
      setVisibleCount(citations.length);
      prevLengthRef.current = citations.length;
      wasStreamingRef.current = false;
      return;
    }

    // Detected transition from not-streaming -> streaming (new query started)
    if (isStreaming && !wasStreamingRef.current) {
      wasStreamingRef.current = true;
      prevLengthRef.current = 0;
      setVisibleCount(0);
    }

    // If citations are still empty during the retrieval/reasoning stages
    if (citations.length === 0) {
      setVisibleCount(0);
      prevLengthRef.current = 0;
      return;
    }

    // When citations arrive or increase in count during streaming
    if (citations.length !== prevLengthRef.current) {
      const prevLen = prevLengthRef.current;
      prevLengthRef.current = citations.length;
      const currentStreamId = ++streamIdRef.current;

      // Start by showing 1 citation immediately so the user doesn't wait
      let count = prevLen === 0 ? 1 : Math.max(1, visibleCountRef.current);
      setVisibleCount(count);

      if (count < citations.length) {
        const timer = setInterval(() => {
          if (streamIdRef.current !== currentStreamId) {
            clearInterval(timer);
            return;
          }

          count += 1;
          setVisibleCount(count);

          if (count >= citations.length) {
            clearInterval(timer);
          }
        }, intervalMs);

        return () => {
          clearInterval(timer);
        };
      }
    }
  }, [citations.length, isStreaming, intervalMs]);

  // When not actively streaming, always guarantee 100% of citations are visible
  const effectiveCount = isStreaming
    ? Math.min(visibleCount, citations.length)
    : citations.length;

  return {
    visibleCitations: citations.slice(0, effectiveCount),
    visibleCount: effectiveCount,
    totalCount: citations.length,
    isStreamingCitations: isStreaming && effectiveCount < citations.length,
  };
}

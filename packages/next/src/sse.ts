import type { AgentStep } from "@agentsdk/core";

/**
 * Encodes an AgentStep as a Server-Sent Event string.
 */
export function encodeSSEEvent(step: AgentStep): string {
  const data = JSON.stringify({
    type: step.type,
    content: step.content,
    timestamp: step.timestamp.toISOString(),
  });
  return `data: ${data}\n\n`;
}

/**
 * Encodes a plain text chunk as SSE (used for text streaming).
 */
export function encodeSSEText(text: string): string {
  return `data: ${JSON.stringify({ type: "text-delta", content: text })}\n\n`;
}

/**
 * Encodes a [DONE] signal to close the SSE stream.
 */
export function encodeSSEDone(): string {
  return `data: [DONE]\n\n`;
}

/**
 * Encodes an error as an SSE event.
 */
export function encodeSSEError(message: string): string {
  return `data: ${JSON.stringify({ type: "error", content: message })}\n\n`;
}

/**
 * Creates a ReadableStream that streams AgentSteps as SSE events.
 */
export function createSSEStream(
  run: (emit: (step: AgentStep) => void, signal: AbortSignal) => Promise<void>,
): ReadableStream {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const abortController = new AbortController();

      const emit = (step: AgentStep) => {
        controller.enqueue(encoder.encode(encodeSSEEvent(step)));
      };

      run(emit, abortController.signal)
        .then(() => {
          controller.enqueue(encoder.encode(encodeSSEDone()));
          controller.close();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(encodeSSEError(message)));
          controller.close();
        });

      return () => {
        abortController.abort();
      };
    },
  });
}

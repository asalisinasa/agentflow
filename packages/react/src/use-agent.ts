"use client";

import { useCallback, useRef, useState } from "react";
import { useAgentConfig } from "./provider.js";
import type { AgentConfig, AgentStatus, Message, SSEEvent, UseAgentReturn } from "./types.js";

function generateId(): string {
  return `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Hook for interacting with an agent via SSE streaming.
 *
 * Can be used with AgentProvider (picks up config automatically)
 * or with an explicit config object.
 *
 * @example with AgentProvider:
 * ```tsx
 * function Chat() {
 *   const { messages, send, status, abort } = useAgent()
 *   return (
 *     <div>
 *       {messages.map(m => <div key={m.id}>{m.content}</div>)}
 *       <button onClick={() => send("Hello!")}>Send</button>
 *       {status === "streaming" && <button onClick={abort}>Stop</button>}
 *     </div>
 *   )
 * }
 * ```
 *
 * @example with explicit config:
 * ```tsx
 * const { messages, send } = useAgent({ endpoint: "/api/agent", token: "my-key" })
 * ```
 */
export function useAgent(explicitConfig?: AgentConfig): UseAgentReturn {
  // Support both explicit config and AgentProvider context
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const contextConfig = explicitConfig
    ? null
    : (() => {
        try {
          return useAgentConfig();
        } catch {
          return null;
        }
      })();
  const config = explicitConfig ?? contextConfig;

  if (!config) {
    throw new Error(
      "useAgent requires either an explicit config or to be wrapped in <AgentProvider>.",
    );
  }

  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (goal: string) => {
      if (status === "streaming") return;

      setError(null);
      setStatus("streaming");

      // Add user message immediately
      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: goal,
        status: "done",
        createdAt: new Date(),
      };

      // Add empty assistant message to stream into
      const assistantId = generateId();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
        steps: [],
        createdAt: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      // Abort controller for cancellation
      abortRef.current = new AbortController();

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...config.headers,
        };

        if (config.token) {
          headers["Authorization"] = `Bearer ${config.token}`;
        }

        const res = await fetch(config.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            goal,
            ...(config.sessionId !== undefined && { sessionId: config.sessionId }),
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        // Read SSE stream
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            const payload = line.slice(6).trim();
            if (payload === "[DONE]") break;

            let event: SSEEvent;
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }

            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;

                if (event.type === "message") {
                  return { ...m, content: event.content as string, status: "done" };
                }

                if (event.type === "error") {
                  return { ...m, content: event.content as string, status: "error" };
                }

                if (event.type === "text-delta") {
                  return { ...m, content: m.content + (event.content as string) };
                }

                // thinking / tool_call / tool_result — add to steps
                return {
                  ...m,
                  steps: [
                    ...(m.steps ?? []),
                    {
                      type: event.type as "thinking" | "tool_call" | "tool_result",
                      content: event.content,
                      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
                    },
                  ],
                };
              }),
            );
          }
        }

        // Mark assistant message done if not already
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.status === "streaming" ? { ...m, status: "done" } : m,
          ),
        );

        setStatus("idle");
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, status: "done", content: m.content || "Cancelled." }
                : m,
            ),
          );
          setStatus("idle");
          return;
        }

        const message = err instanceof Error ? err.message : "Something went wrong";
        setError(message);
        setStatus("error");
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, status: "error", content: message } : m)),
        );
      }
    },
    [config, status],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    setStatus("idle");
  }, []);

  return {
    messages,
    status,
    error,
    send,
    abort,
    clear,
    isStreaming: status === "streaming",
  };
}

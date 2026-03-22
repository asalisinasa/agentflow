import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  ToolDefinition,
} from "@agentsdk/core";
import type { CoreMessage, CoreTool, LanguageModel } from "ai";
import { generateText, streamText } from "ai";
import { z } from "zod";

/**
 * Config for creating a Vercel AI SDK provider.
 */
export interface VercelAIProviderConfig {
  /**
   * The AI SDK model instance.
   * @example openai("gpt-4o")
   * @example anthropic("claude-sonnet-4-5")
   * @example google("gemini-2.0-flash")
   */
  model: LanguageModel;

  /** Default temperature (0–1). Overridable per-call via LLMOptions. */
  temperature?: number;

  /** Default max tokens. Overridable per-call via LLMOptions. */
  maxTokens?: number;
}

/**
 * Creates an LLMProvider backed by the Vercel AI SDK.
 *
 * Works with any AI SDK-compatible model — OpenAI, Anthropic, Google, and more.
 *
 * @example
 * ```ts
 * import { openai } from "@ai-sdk/openai"
 * import { createVercelAIProvider } from "@agentsdk/adapter-vercel-ai"
 *
 * const provider = createVercelAIProvider({ model: openai("gpt-4o") })
 * ```
 */
export function createVercelAIProvider(config: VercelAIProviderConfig): LLMProvider {
  return {
    async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
      const coreMessages = toCoreMessages(messages);
      const tools = options?.tools ? toAISDKTools(options.tools) : undefined;

      const result = await generateText({
        model: config.model,
        messages: coreMessages,
        temperature: options?.temperature ?? config.temperature,
        maxTokens: options?.maxTokens ?? config.maxTokens,
        tools,
        abortSignal: options?.signal,
      });

      return {
        content: result.text,
        finishReason: toFinishReason(result.finishReason),
        toolCalls: result.toolCalls?.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: tc.args as Record<string, unknown>,
        })),
        usage: result.usage
          ? {
              inputTokens: result.usage.promptTokens,
              outputTokens: result.usage.completionTokens,
            }
          : undefined,
      };
    },

    async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string> {
      const coreMessages = toCoreMessages(messages);

      const result = streamText({
        model: config.model,
        messages: coreMessages,
        temperature: options?.temperature ?? config.temperature,
        maxTokens: options?.maxTokens ?? config.maxTokens,
        abortSignal: options?.signal,
      });

      for await (const chunk of result.textStream) {
        yield chunk;
      }
    },
  };
}

// ─── Type converters ──────────────────────────────────────────────────────────

function toCoreMessages(messages: LLMMessage[]): CoreMessage[] {
  return messages.map((m): CoreMessage => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: m.toolCallId ?? "",
            toolName: m.toolName ?? "",
            result: m.content,
          },
        ],
      };
    }

    return {
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    };
  });
}

function toAISDKTools(tools: ToolDefinition[]): Record<string, CoreTool> {
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        description: tool.description,
        // AI SDK expects a Zod schema — we wrap the JSON Schema in z.object
        // For full JSON Schema support, use the adapter's jsonSchema() helper
        parameters: z.object(
          Object.fromEntries(
            Object.entries(
              (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {},
            ).map(([key]) => [key, z.unknown()]),
          ),
        ),
      },
    ]),
  );
}

function toFinishReason(reason: string): "stop" | "tool_calls" | "length" | "error" {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool-calls":
      return "tool_calls";
    case "length":
      return "length";
    default:
      return "stop";
  }
}

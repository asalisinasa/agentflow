import { RuleEngine } from "../rules/rule-engine.js";
import type {
  Agent,
  AgentAction,
  AgentConfig,
  AgentContext,
  AgentRunOptions,
  AgentRunResult,
  AgentStatus,
  AgentStep,
  LLMMessage,
  LLMResponse,
  Task,
  ToolCall,
  ToolResult,
} from "../types/index.js";
import { generateId } from "../utils.js";

export abstract class BaseAgent implements Agent {
  readonly id: string;
  readonly config: AgentConfig;
  status: AgentStatus = "idle";

  private ruleEngine: RuleEngine;

  constructor(config: AgentConfig) {
    this.id = config.id ?? generateId("agent");
    this.config = config;
    this.ruleEngine = new RuleEngine(config.rules ?? []);
  }

  // ─── Abstract — subclasses implement LLM call ────────────────────────────

  protected abstract callLLM(messages: LLMMessage[], context: AgentContext): Promise<LLMResponse>;

  // ─── Public API ──────────────────────────────────────────────────────────

  canHandle(task: Task): boolean {
    if (!task.requiredSkill) return true;
    return (this.config.skills ?? []).some((s) => s.name === task.requiredSkill);
  }

  async run(goal: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    if (this.status === "running") {
      throw new Error(`Agent ${this.id} is already running`);
    }

    this.status = "running";
    const steps: AgentStep[] = [];
    const context = this.buildContext(options);

    const emit = (step: AgentStep) => {
      steps.push(step);
      options.onStep?.(step);
    };

    try {
      const result = await this.agentLoop(goal, context, emit, options.signal);
      this.status = "idle";
      return { output: result, steps };
    } catch (err) {
      this.status = "error";
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: "error", content: message, timestamp: new Date() });
      throw err;
    }
  }

  async *stream(goal: string, options: AgentRunOptions = {}): AsyncIterable<AgentStep> {
    const buffer: AgentStep[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const onStep = (step: AgentStep) => {
      buffer.push(step);
      resolve?.();
    };

    this.run(goal, { ...options, onStep }).finally(() => {
      done = true;
      resolve?.();
    });

    while (!done || buffer.length > 0) {
      if (buffer.length === 0) {
        await new Promise<void>((r) => {
          resolve = r;
        });
        resolve = null;
      }
      while (buffer.length > 0) {
        yield buffer.shift()!;
      }
    }
  }

  // ─── Agent loop ──────────────────────────────────────────────────────────

  private async agentLoop(
    goal: string,
    context: AgentContext,
    emit: (step: AgentStep) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const maxIterations = this.config.maxIterations ?? 10;
    const messages: LLMMessage[] = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: goal },
    ];

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) throw new Error("Agent run aborted");

      emit({ type: "thinking", content: `Iteration ${i + 1}`, timestamp: new Date() });

      const response = await this.callLLM(messages, context);

      // Pure text response — we're done
      if (!response.toolCalls?.length || response.finishReason === "stop") {
        emit({ type: "message", content: response.content, timestamp: new Date() });

        return response.content;
      }

      // Process tool calls
      messages.push({ role: "assistant", content: response.content });

      const toolResults = await this.executeToolCalls(response.toolCalls, context, emit);

      for (const result of toolResults) {
        const toolName = response.toolCalls.find((tc) => tc.id === result.toolCallId)?.name;

        messages.push({
          role: "tool",
          content: JSON.stringify(result.result ?? result.error),
          toolCallId: result.toolCallId,
          ...(toolName !== undefined && { toolName }),
        });
      }
    }

    throw new Error(`Agent ${this.id} exceeded max iterations (${maxIterations})`);
  }

  // ─── Tool execution ──────────────────────────────────────────────────────

  private async executeToolCalls(
    toolCalls: ToolCall[],
    context: AgentContext,
    emit: (step: AgentStep) => void,
  ): Promise<ToolResult[]> {
    return Promise.all(
      toolCalls.map(async (tc) => {
        emit({ type: "tool_call", content: tc, timestamp: new Date() });

        // Check rules before executing
        const action: AgentAction = { type: "tool_call", payload: tc };
        const ruleCheck = await this.ruleEngine.validate(action, context);

        if (!ruleCheck.allowed) {
          const result: ToolResult = {
            toolCallId: tc.id,
            result: null,
            error: `Blocked by rule: ${ruleCheck.reason}`,
          };

          emit({ type: "tool_result", content: result, timestamp: new Date() });

          return result;
        }

        // Find and execute tool
        const tool = (this.config.tools ?? []).find((t) => t.definition.name === tc.name);

        if (!tool) {
          const result: ToolResult = {
            toolCallId: tc.id,
            result: null,
            error: `Tool not found: ${tc.name}`,
          };

          emit({ type: "tool_result", content: result, timestamp: new Date() });

          return result;
        }

        try {
          const output = await tool.handler(tc.arguments, context);
          const result: ToolResult = { toolCallId: tc.id, result: output };

          emit({ type: "tool_result", content: result, timestamp: new Date() });

          return result;
        } catch (err) {
          const result: ToolResult = {
            toolCallId: tc.id,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          };

          emit({ type: "tool_result", content: result, timestamp: new Date() });

          return result;
        }
      }),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    const parts = [this.config.instructions];

    if (this.config.skills?.length) {
      parts.push(
        "\nYou have the following skills:\n" +
          this.config.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n"),
      );
    }

    return parts.join("\n");
  }

  private buildContext(options: AgentRunOptions): AgentContext {
    return {
      agentId: this.id,
      sessionId: options.sessionId ?? generateId("session"),
      userId: options.userId,
      memory: this.config.memory,
      signal: options.signal,
      ...options.context,
    };
  }
}

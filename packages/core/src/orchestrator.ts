import { TaskQueue, TaskRouter } from "./tasks/task-queue.js";
import type {
  Agent,
  AgentContext,
  AgentRunOptions,
  OrchestratorConfig,
  Plan,
  Planner,
  Task,
} from "./types/index.js";
import { generateId } from "./utils.js";

export interface OrchestrateOptions {
  sessionId?: string;
  userId?: string;
  signal?: AbortSignal;
  onTaskUpdate?: (task: Task) => void;
  onStep?: AgentRunOptions["onStep"];
  maxConcurrentTasks?: number;
}

export interface OrchestrateResult {
  plan: Plan;
  outputs: Record<string, unknown>; // taskId → output
}

export class Orchestrator {
  private agents: Agent[];
  private planner: Planner | undefined;
  private queue: TaskQueue;
  private router: TaskRouter;
  private maxConcurrentTasks: number;

  constructor(config: OrchestratorConfig) {
    this.agents = config.agents;
    this.planner = config.planner;
    this.queue = new TaskQueue();
    this.router = new TaskRouter(config.agents);
    this.maxConcurrentTasks = config.maxConcurrentTasks ?? 3;
  }

  // ─── Single agent run (no planning) ────────────────────────────────────

  async run(goal: string, agentId?: string, options: OrchestrateOptions = {}): Promise<string> {
    const agent = agentId ? this.agents.find((a) => a.id === agentId) : this.agents[0];

    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const result = await agent.run(goal, {
      sessionId: options.sessionId,
      userId: options.userId,
      signal: options.signal,
      onStep: options.onStep,
    });

    return result.output;
  }

  // ─── Multi-agent orchestration with planning ────────────────────────────

  async orchestrate(goal: string, options: OrchestrateOptions = {}): Promise<OrchestrateResult> {
    if (!this.planner) {
      throw new Error("Orchestrator needs a Planner to decompose goals into tasks");
    }

    const context = this.buildContext(options);
    const plan = await this.planner.createPlan(goal, context);

    // Load tasks into queue
    for (const task of plan.tasks) {
      this.queue.create(task);
    }

    const outputs: Record<string, unknown> = {};
    const running = new Map<string, Promise<void>>();

    // Execute until all tasks done or failed
    while (true) {
      const readyTasks = this.queue.getReady();
      const activeTasks = running.size;

      // Dispatch ready tasks up to concurrency limit
      for (const task of readyTasks) {
        if (activeTasks + running.size >= this.maxConcurrentTasks) break;

        const agent = this.router.route(task);

        if (!agent) continue;

        const updated = this.queue.update(task.id, {
          status: "running",
          assignedTo: agent.id,
        });

        options.onTaskUpdate?.(updated);

        const promise = agent
          .run(task.goal, {
            sessionId: options.sessionId,
            userId: options.userId,
            signal: options.signal,
            context: { ...context },
            onStep: options.onStep,
          })
          .then((result) => {
            outputs[task.id] = result.output;
            const done = this.queue.update(task.id, {
              status: "done",
              output: result.output,
            });
            options.onTaskUpdate?.(done);
          })
          .catch((err) => {
            const failed = this.queue.update(task.id, {
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            });
            options.onTaskUpdate?.(failed);
          })
          .finally(() => {
            running.delete(task.id);
          });

        running.set(task.id, promise);
      }

      if (running.size === 0) break;

      // Wait for at least one task to finish
      await Promise.race(running.values());
    }

    const allTasks = this.queue.getAll();
    const hasFailed = allTasks.some((t) => t.status === "failed");

    return {
      plan: {
        ...plan,
        status: hasFailed ? "failed" : "done",
      },
      outputs,
    };
  }

  // ─── Agent registry ─────────────────────────────────────────────────────

  addAgent(agent: Agent): void {
    this.agents.push(agent);
    this.router.addAgent(agent);
  }

  removeAgent(id: string): void {
    this.agents = this.agents.filter((a) => a.id !== id);
    this.router.removeAgent(id);
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.find((a) => a.id === id);
  }

  getAgents(): Agent[] {
    return [...this.agents];
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildContext(options: OrchestrateOptions): AgentContext {
    return {
      agentId: "orchestrator",
      sessionId: options.sessionId ?? generateId("session"),
      userId: options.userId,
      signal: options.signal,
    };
  }
}

import type { AgentContext, LLMProvider, Plan, Planner, Task } from "../types/index.js";
import { generateId } from "../utils.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface LLMPlannerConfig {
  /**
   * The LLM provider to use for plan generation.
   * Usually the same provider as your agents.
   */
  provider: LLMProvider;

  /**
   * Max number of tasks in a plan.
   * Prevents the LLM from over-decomposing.
   * @default 10
   */
  maxTasks?: number;

  /**
   * Available skill names the planner can assign to tasks.
   * If provided, the LLM will only assign known skills.
   */
  availableSkills?: string[];

  /**
   * Custom system prompt to guide plan generation.
   * Appended to the default prompt.
   */
  systemPromptSuffix?: string;
}

// ─── LLMPlanner ───────────────────────────────────────────────────────────────

/**
 * A Planner implementation that uses an LLM to decompose a goal into tasks.
 *
 * Works with any LLMProvider — plug in the same provider as your agents.
 *
 * @example
 * ```ts
 * import { LLMPlanner } from "@agentsdk/core"
 * import { createVercelAIProvider } from "@agentsdk/adapter-vercel-ai"
 * import { openai } from "@ai-sdk/openai"
 *
 * const planner = new LLMPlanner({
 *   provider: createVercelAIProvider({ model: openai("gpt-4o") }),
 *   availableSkills: ["web_search", "summarize", "write_code"],
 * })
 *
 * const plan = await planner.createPlan("Research and write a blog post about AI agents")
 * // → Plan with tasks: [research, outline, write, review]
 * ```
 */
export class LLMPlanner implements Planner {
  private readonly config: Required<LLMPlannerConfig>;

  constructor(config: LLMPlannerConfig) {
    this.config = {
      maxTasks: 10,
      availableSkills: [],
      systemPromptSuffix: "",
      ...config,
    };
  }

  // ─── createPlan ─────────────────────────────────────────────────────────────

  async createPlan(goal: string, _context?: AgentContext): Promise<Plan> {
    const response = await this.config.provider.complete([
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: `Goal: ${goal}` },
    ]);

    const tasks = this.parseTasks(response.content);

    return {
      id: generateId("plan"),
      goal,
      tasks,
      status: "draft",
      createdAt: new Date(),
    };
  }

  // ─── validatePlan ───────────────────────────────────────────────────────────

  async validatePlan(plan: Plan): Promise<{ valid: boolean; issues?: string[] }> {
    const issues: string[] = [];

    if (plan.tasks.length === 0) {
      issues.push("Plan has no tasks");
    }

    if (plan.tasks.length > this.config.maxTasks) {
      issues.push(`Plan has ${plan.tasks.length} tasks, max is ${this.config.maxTasks}`);
    }

    // Check for circular dependencies
    const circular = this.findCircularDependencies(plan.tasks);
    if (circular.length > 0) {
      issues.push(`Circular dependencies detected: ${circular.join(", ")}`);
    }

    // Check that all dependsOn references exist
    const taskIds = new Set(plan.tasks.map((t) => t.id));
    for (const task of plan.tasks) {
      for (const dep of task.dependsOn ?? []) {
        if (!taskIds.has(dep)) {
          issues.push(`Task "${task.goal}" depends on unknown task ID: ${dep}`);
        }
      }
    }

    // Check skills
    if (this.config.availableSkills.length > 0) {
      for (const task of plan.tasks) {
        if (task.requiredSkill && !this.config.availableSkills.includes(task.requiredSkill)) {
          issues.push(`Task "${task.goal}" requires unknown skill: ${task.requiredSkill}`);
        }
      }
    }

    return { valid: issues.length === 0, issues: issues.length > 0 ? issues : undefined };
  }

  // ─── Prompt ─────────────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    const skillsSection =
      this.config.availableSkills.length > 0
        ? `\nAvailable skills: ${this.config.availableSkills.join(", ")}`
        : "";

    return `You are a task planner. Decompose the given goal into a list of concrete, executable tasks.

Rules:
- Output ONLY valid JSON — no markdown, no explanation, no code fences
- Max ${this.config.maxTasks} tasks
- Each task must have: goal (string), requiredSkill (string or null), dependsOn (array of indices, 0-based)
- dependsOn should reference the index of tasks that must complete first
- Keep tasks atomic — one clear action per task
- Be specific, not abstract${skillsSection}

Output format:
{
  "tasks": [
    { "goal": "...", "requiredSkill": "skill_name_or_null", "dependsOn": [] },
    { "goal": "...", "requiredSkill": "skill_name_or_null", "dependsOn": [0] }
  ]
}
${this.config.systemPromptSuffix}`.trim();
  }

  // ─── Parse LLM output ────────────────────────────────────────────────────────

  private parseTasks(content: string): Task[] {
    let parsed: {
      tasks: Array<{ goal: string; requiredSkill?: string | null; dependsOn?: number[] }>;
    };

    try {
      // Strip markdown code fences if the LLM added them anyway
      const clean = content.replace(/```(?:json)?\n?/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      // Fallback: treat the whole goal as a single task
      return [this.makeTask("Complete the requested goal", [], null)];
    }

    if (!Array.isArray(parsed.tasks)) {
      return [this.makeTask("Complete the requested goal", [], null)];
    }

    // First pass: create tasks with temporary numeric IDs
    const tasks = parsed.tasks.slice(0, this.config.maxTasks).map((t, _i) =>
      this.makeTask(
        t.goal ?? "Unnamed task",
        [], // dependsOn filled in second pass
        t.requiredSkill ?? null,
      ),
    );

    // Second pass: resolve index-based dependsOn to task IDs
    parsed.tasks.slice(0, this.config.maxTasks).forEach((t, i) => {
      const task = tasks[i];
      if (!task) return;
      task.dependsOn = (t.dependsOn ?? [])
        .filter((idx) => idx >= 0 && idx < tasks.length && idx !== i)
        .map((idx) => tasks[idx]?.id ?? "")
        .filter(Boolean);
    });

    return tasks;
  }

  private makeTask(goal: string, dependsOn: string[], requiredSkill: string | null): Task {
    return {
      id: generateId("task"),
      goal,
      input: {},
      status: "pending",
      dependsOn,
      ...(requiredSkill !== null && { requiredSkill }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // ─── Circular dependency check ────────────────────────────────────────────────

  private findCircularDependencies(tasks: Task[]): string[] {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const circular: string[] = [];

    const visit = (id: string, path: Set<string>): boolean => {
      if (path.has(id)) return true;
      const task = taskMap.get(id);
      if (!task) return false;
      path.add(id);
      for (const dep of task.dependsOn ?? []) {
        if (visit(dep, new Set(path))) {
          circular.push(id);
          return true;
        }
      }
      return false;
    };

    for (const task of tasks) {
      visit(task.id, new Set());
    }

    return [...new Set(circular)];
  }
}

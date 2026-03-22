import { describe, expect, it, vi } from "vitest";
import { LLMPlanner } from "../src/planning/llm-planner.js";
import type { LLMProvider } from "../src/types/index.js";

// ─── Mock provider ────────────────────────────────────────────────────────────

function makeMockProvider(response: string): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: response,
      finishReason: "stop",
    }),
  };
}

const validPlanJSON = JSON.stringify({
  tasks: [
    { goal: "Search for information", requiredSkill: "web_search", dependsOn: [] },
    { goal: "Summarise findings", requiredSkill: "summarize", dependsOn: [0] },
    { goal: "Write the final report", requiredSkill: null, dependsOn: [1] },
  ],
});

// ─── createPlan ───────────────────────────────────────────────────────────────

describe("LLMPlanner.createPlan", () => {
  it("returns a plan with tasks", async () => {
    const planner = new LLMPlanner({ provider: makeMockProvider(validPlanJSON) });
    const plan = await planner.createPlan("Write a report about AI agents");

    expect(plan.id).toMatch(/^plan_/);
    expect(plan.goal).toBe("Write a report about AI agents");
    expect(plan.tasks).toHaveLength(3);
    expect(plan.status).toBe("draft");
    expect(plan.createdAt).toBeInstanceOf(Date);
  });

  it("maps requiredSkill correctly", async () => {
    const planner = new LLMPlanner({ provider: makeMockProvider(validPlanJSON) });
    const plan = await planner.createPlan("goal");

    expect(plan.tasks[0]?.requiredSkill).toBe("web_search");
    expect(plan.tasks[1]?.requiredSkill).toBe("summarize");
    expect(plan.tasks[2]?.requiredSkill).toBeUndefined();
  });

  it("resolves dependsOn indices to task IDs", async () => {
    const planner = new LLMPlanner({ provider: makeMockProvider(validPlanJSON) });
    const plan = await planner.createPlan("goal");

    const [t0, t1, t2] = plan.tasks;
    expect(t0?.dependsOn).toEqual([]);
    expect(t1?.dependsOn).toEqual([t0?.id]);
    expect(t2?.dependsOn).toEqual([t1?.id]);
  });

  it("falls back to a single task when LLM returns invalid JSON", async () => {
    const planner = new LLMPlanner({ provider: makeMockProvider("not valid json at all") });
    const plan = await planner.createPlan("goal");

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.goal).toBe("Complete the requested goal");
  });

  it("strips markdown code fences from LLM output", async () => {
    const withFences = "```json\n" + validPlanJSON + "\n```";
    const planner = new LLMPlanner({ provider: makeMockProvider(withFences) });
    const plan = await planner.createPlan("goal");

    expect(plan.tasks).toHaveLength(3);
  });

  it("respects maxTasks limit", async () => {
    const manyTasks = JSON.stringify({
      tasks: Array.from({ length: 20 }, (_, i) => ({
        goal: `Task ${i}`,
        requiredSkill: null,
        dependsOn: [],
      })),
    });
    const planner = new LLMPlanner({
      provider: makeMockProvider(manyTasks),
      maxTasks: 5,
    });
    const plan = await planner.createPlan("goal");

    expect(plan.tasks).toHaveLength(5);
  });
});

// ─── validatePlan ─────────────────────────────────────────────────────────────

describe("LLMPlanner.validatePlan", () => {
  it("validates a correct plan", async () => {
    const planner = new LLMPlanner({ provider: makeMockProvider(validPlanJSON) });
    const plan = await planner.createPlan("goal");
    const result = await planner.validatePlan(plan);

    expect(result.valid).toBe(true);
    expect(result.issues).toBeUndefined();
  });

  it("rejects a plan with no tasks", async () => {
    const planner = new LLMPlanner({ provider: makeMockProvider("{}") });
    const plan = await planner.createPlan("goal");
    const result = await planner.validatePlan({ ...plan, tasks: [] });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Plan has no tasks");
  });

  it("rejects unknown skills when availableSkills is set", async () => {
    const planner = new LLMPlanner({
      provider: makeMockProvider(validPlanJSON),
      availableSkills: ["summarize"],
    });
    const plan = await planner.createPlan("goal");
    const result = await planner.validatePlan(plan);

    expect(result.valid).toBe(false);
    expect(result.issues?.some((i) => i.includes("web_search"))).toBe(true);
  });

  it("detects circular dependencies", async () => {
    const planner = new LLMPlanner({ provider: makeMockProvider(validPlanJSON) });
    const plan = await planner.createPlan("goal");

    // Manually create a cycle: task0 depends on task2, task2 depends on task1, task1 depends on task0
    const [t0, t1, t2] = plan.tasks;
    if (!t0 || !t1 || !t2) return;
    t0.dependsOn = [t2.id];
    t2.dependsOn = [t1.id];
    t1.dependsOn = [t0.id];

    const result = await planner.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.issues?.some((i) => i.includes("Circular"))).toBe(true);
  });
});

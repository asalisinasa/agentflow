# @agentsdk/core

Framework-agnostic, zero-dependency foundation for multi-agent systems.

## What's in here

| Export          | What it is                                                             |
| --------------- | ---------------------------------------------------------------------- |
| `BaseAgent`     | Abstract class — extend and implement `callLLM()`                      |
| `Orchestrator`  | Coordinates multiple agents, runs plans                                |
| `TaskQueue`     | In-process task lifecycle and dependency tracking                      |
| `TaskRouter`    | Routes tasks to the right agent by skill                               |
| `RuleEngine`    | Validates agent actions before execution                               |
| `InMemoryStore` | MemoryStore for dev/testing                                            |
| `defineTool`    | Type-safe tool builder                                                 |
| Built-in rules  | `blockToolsRule`, `allowToolsRule`, `requireAuthRule`, `rateLimitRule` |

All types are exported from the root — import everything from `@agentsdk/core`.

## Usage

### 1. Implement an agent

```ts
import { BaseAgent } from "@agentsdk/core";
import type { LLMMessage, LLMResponse, AgentContext } from "@agentsdk/core";

class MyAgent extends BaseAgent {
  protected async callLLM(messages: LLMMessage[], context: AgentContext): Promise<LLMResponse> {
    // plug in any LLM — Anthropic, OpenAI, Vercel AI SDK, etc.
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "gpt-4o", messages }),
    }).then((r) => r.json());

    return {
      content: response.choices[0].message.content,
      finishReason: response.choices[0].finish_reason,
    };
  }
}

const agent = new MyAgent({
  name: "Researcher",
  description: "Researches topics and summarises findings",
  instructions: "You are a research assistant. Be concise and cite sources.",
});

const result = await agent.run("What is the current state of multi-agent AI?");
console.log(result.output);
```

### 2. Add tools

```ts
import { defineTool } from "@agentsdk/core";

const searchTool = defineTool({
  name: "web_search",
  description: "Search the web for current information",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
  async execute({ query }) {
    // your search implementation
    return { results: [] };
  },
});

const agent = new MyAgent({
  name: "Researcher",
  description: "...",
  instructions: "...",
  tools: [searchTool],
});
```

### 3. Add rules

```ts
import { blockToolsRule, requireAuthRule, rateLimitRule } from "@agentsdk/core";

const agent = new MyAgent({
  name: "Researcher",
  description: "...",
  instructions: "...",
  rules: [requireAuthRule(), blockToolsRule(["delete_file", "execute_code"]), rateLimitRule(50)],
});
```

### 4. Orchestrate multiple agents

```ts
import { Orchestrator } from "@agentsdk/core";

const orchestrator = new Orchestrator({
  agents: [researchAgent, writerAgent, reviewerAgent],
  // planner: myPlanner, // optional — enables goal decomposition
});

// Single agent
const output = await orchestrator.run("Summarise the latest AI papers", "researcher-agent-id");

// Multi-agent with planning
const { plan, outputs } = await orchestrator.orchestrate(
  "Research, write, and review an article about agentic AI",
  {
    onTaskUpdate: (task) => console.log(`${task.id}: ${task.status}`),
  },
);
```

## Design principles

- **Zero dependencies** — no LLM library, no framework, no runtime magic.
  Bring your own LLM by implementing `callLLM()` in your agent.
- **Extend, don't configure** — `BaseAgent` is a class you subclass, not a config object you fill in.
- **Rules before execution** — every tool call passes through `RuleEngine` before firing.
- **Dependency-aware tasks** — `TaskQueue.getReady()` respects `dependsOn` so you never need to manually order tasks.

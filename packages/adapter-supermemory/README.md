# @agentsdk/adapter-supermemory

Supermemory adapter for `@agentsdk/core`. Gives your agents persistent, cross-session memory with built-in RAG and user profiles — one line of code.

## Install

```bash
pnpm add @agentsdk/core @agentsdk/adapter-supermemory
```

Get an API key at [supermemory.ai](https://supermemory.ai) or self-host.

## Usage

### Drop-in replacement for InMemoryStore

`SupermemoryStore` implements the same `MemoryStore` interface as `InMemoryStore` — swap it in without changing agent code:

```ts
import { VercelAIAgent } from "@agentsdk/adapter-vercel-ai";
import { SupermemoryStore } from "@agentsdk/adapter-supermemory";
import { openai } from "@ai-sdk/openai";

const agent = new VercelAIAgent({
  name: "Assistant",
  description: "A helpful assistant with persistent memory",
  instructions: "You are a helpful assistant. Use your memory to personalise responses.",
  model: openai("gpt-4o"),
  memory: new SupermemoryStore({
    apiKey: process.env.SUPERMEMORY_API_KEY,
    containerTag: `user_${userId}`, // scope memory per user
  }),
});
```

### Scoping with containerTag

Always scope memory with `containerTag` to prevent memories leaking across users or projects:

```ts
// Per user
new SupermemoryStore({ containerTag: `user_${userId}` });

// Per session
new SupermemoryStore({ containerTag: `session_${sessionId}` });

// Per project
new SupermemoryStore({ containerTag: `project_${projectId}` });
```

### Self-hosted instance

```ts
new SupermemoryStore({
  apiKey: process.env.SUPERMEMORY_API_KEY,
  baseURL: "https://your-supermemory.example.com",
  containerTag: "my-app",
});
```

### Using the MemoryStore interface directly

```ts
import { SupermemoryStore } from "@agentsdk/adapter-supermemory";

const memory = new SupermemoryStore({
  apiKey: process.env.SUPERMEMORY_API_KEY,
  containerTag: "user_123",
});

// Save a memory
await memory.save({ content: "User prefers dark mode and TypeScript" });

// Semantic search
const results = await memory.search("What are the user's preferences?", 5);
// → [{ id: "...", content: "User prefers dark mode and TypeScript", ... }]

// Get by ID
const entry = await memory.get("mem_abc123");

// Delete
await memory.delete("mem_abc123");

// Clear all memories in scope
await memory.clear();
```

## API

```ts
new SupermemoryStore(config?: SupermemoryStoreConfig)
```

| Option               | Type     | Default                      | Description                      |
| -------------------- | -------- | ---------------------------- | -------------------------------- |
| `apiKey`             | `string` | `SUPERMEMORY_API_KEY` env    | Supermemory API key              |
| `baseURL`            | `string` | `https://api.supermemory.ai` | For self-hosted instances        |
| `containerTag`       | `string` | —                            | Scope memories to a user/project |
| `defaultSearchLimit` | `number` | `10`                         | Default results per search       |

## Why Supermemory over InMemoryStore

|                 | `InMemoryStore`    | `SupermemoryStore` |
| --------------- | ------------------ | ------------------ |
| Persistence     | ❌ lost on restart | ✅ permanent       |
| Cross-session   | ❌                 | ✅                 |
| Semantic search | keyword only       | ✅ vector + RAG    |
| User profiles   | ❌                 | ✅ auto-built      |
| Self-hosted     | ✅                 | ✅                 |
| API key needed  | ❌                 | ✅                 |

Use `InMemoryStore` for development and tests, `SupermemoryStore` in production.

# @agentsdk/next

Next.js App Router integration for `@agentsdk/core`.

Turns any agent into a Next.js API route with SSE streaming and auth — in 3 lines of code.

## Install

```bash
pnpm add @agentsdk/core @agentsdk/next
```

## Usage

### Minimal setup

```ts
// app/api/agent/route.ts
import { createAgentRoute } from "@agentsdk/next";
import { myAgent } from "@/agents/my-agent";

export const { POST } = createAgentRoute({ agent: myAgent });
```

Call it from the client:

```ts
const res = await fetch("/api/agent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ goal: "Summarise the latest AI news" }),
});
```

### With SSE streaming

Streaming is on by default. Read the SSE events on the client:

```ts
const res = await fetch("/api/agent", {
  method: "POST",
  body: JSON.stringify({ goal: "Write a short essay on agentic AI" }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const lines = decoder.decode(value).split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") break;
    const event = JSON.parse(payload);
    console.log(event.type, event.content);
  }
}
```

### With auth

```ts
// Bearer token (API key auth)
export const { POST } = createAgentRoute({
  agent: myAgent,
  auth: bearerTokenAuth(),
});

// NextAuth
import { getServerSession } from "next-auth";
export const { POST } = createAgentRoute({
  agent: myAgent,
  auth: async () => {
    const session = await getServerSession();
    if (!session?.user?.id) return { authenticated: false };
    return { authenticated: true, userId: session.user.id };
  },
});

// Clerk
import { auth } from "@clerk/nextjs/server";
export const { POST } = createAgentRoute({
  agent: myAgent,
  auth: async () => {
    const { userId } = await auth();
    if (!userId) return { authenticated: false };
    return { authenticated: true, userId };
  },
});
```

### With lifecycle hooks

```ts
export const { POST } = createAgentRoute({
  agent: myAgent,
  auth: bearerTokenAuth(),

  // Modify or validate the goal before the agent runs
  onRequest: async (goal, req) => {
    console.log("Agent requested:", goal);
    // Optionally return a modified goal
  },

  // Log or persist the result after the agent finishes
  onComplete: async (output, req) => {
    await db.logs.create({ output, timestamp: new Date() });
  },
});
```

## Request format

```json
{
  "goal": "What is the capital of France?",
  "sessionId": "optional-session-id"
}
```

## SSE event format

Each event is a JSON object:

```json
{ "type": "thinking", "content": "Iteration 1", "timestamp": "..." }
{ "type": "tool_call", "content": { "name": "search", "arguments": {} }, "timestamp": "..." }
{ "type": "tool_result", "content": { "result": "..." }, "timestamp": "..." }
{ "type": "message", "content": "The capital of France is Paris.", "timestamp": "..." }
```

Stream ends with:

```
data: [DONE]
```

## API

### `createAgentRoute(config)`

| Option        | Type          | Default    | Description            |
| ------------- | ------------- | ---------- | ---------------------- |
| `agent`       | `Agent`       | required   | Agent to run           |
| `auth`        | `AuthHandler` | `noAuth()` | Auth function          |
| `streaming`   | `boolean`     | `true`     | Enable SSE streaming   |
| `maxBodySize` | `number`      | `1048576`  | Max body size in bytes |
| `onRequest`   | `function`    | —          | Before-run hook        |
| `onComplete`  | `function`    | —          | After-run hook         |

### `bearerTokenAuth()`

Reads `Authorization: Bearer <token>` header. Returns token as `userId`.

### `noAuth(userId?)`

Allows all requests. For development only.

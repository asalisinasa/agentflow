# @agentsdk/react

React hooks and components for `@agentsdk/core`. Connects your UI to agents running via `@agentsdk/next`.

## Install

```bash
pnpm add @agentsdk/core @agentsdk/react
```

## Quick start

### Option A — ChatUI (drop-in component)

```tsx
import { ChatUI } from "@agentsdk/react";

export default function Page() {
  return (
    <ChatUI
      config={{ endpoint: "/api/agent", token: "my-key" }}
      placeholder="Ask me anything..."
      welcomeMessage="Hi! How can I help you today?"
    />
  );
}
```

### Option B — useAgent hook (custom UI)

```tsx
import { AgentProvider, useAgent } from "@agentsdk/react";

// Wrap once in your layout
export function Providers({ children }) {
  return <AgentProvider config={{ endpoint: "/api/agent" }}>{children}</AgentProvider>;
}

// Use anywhere inside
function Chat() {
  const { messages, send, abort, isStreaming } = useAgent();

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id} data-role={m.role}>
          {m.content}
        </div>
      ))}
      <button onClick={() => send("Hello!")}>Send</button>
      {isStreaming && <button onClick={abort}>Stop</button>}
    </div>
  );
}
```

### Option C — assistant-ui (fully styled)

Install assistant-ui components via shadcn CLI:

```bash
npx shadcn@latest add "https://r.assistant-ui.com/thread"
```

Then wire up with our adapter:

```tsx
import { AssistantRuntimeProvider, Thread, useExternalStoreRuntime } from "@assistant-ui/react";
import { createAssistantUIAdapter } from "@agentsdk/react";

export function Chat() {
  const adapter = createAssistantUIAdapter({ endpoint: "/api/agent" });
  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

## API

### `AgentProvider`

```tsx
<AgentProvider config={{ endpoint, token?, sessionId?, headers? }}>
  {children}
</AgentProvider>
```

### `useAgent(config?)`

```ts
const {
  messages, // Message[] — conversation history
  status, // "idle" | "streaming" | "error"
  error, // string | null
  send, // (goal: string) => Promise<void>
  abort, // () => void — cancel current run
  clear, // () => void — reset conversation
  isStreaming, // boolean — shorthand for status === "streaming"
} = useAgent();
```

### `ChatUI`

```tsx
<ChatUI
  config?={AgentConfig}          // optional if inside AgentProvider
  placeholder?="Send a message..."
  welcomeMessage?="Hello!"
  className?="my-chat"
/>
```

ChatUI is **unstyled** — target with `data-agentsdk-*` attributes:

```css
[data-agentsdk-chat] {
  display: flex;
  flex-direction: column;
}
[data-agentsdk-message][data-role="user"] {
  text-align: right;
}
[data-agentsdk-message][data-role="assistant"] {
  text-align: left;
}
[data-agentsdk-input] {
  flex: 1;
}
[data-agentsdk-cursor] {
  animation: blink 1s step-end infinite;
}
```

### `createAssistantUIAdapter(config)`

Returns a runtime adapter for `useExternalStoreRuntime()` from `@assistant-ui/react`.
Connects assistant-ui's Thread component to your `@agentsdk/next` route.

## Message shape

```ts
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  steps?: AgentStep[]; // thinking, tool_call, tool_result events
  createdAt: Date;
}
```

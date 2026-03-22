import { VercelAIAgent } from "@agentsdk/adapter-vercel-ai";
import { bearerTokenAuth, createAgentRoute } from "@agentsdk/next";
import { createOllama } from "ollama-ai-provider";

const ollama = createOllama();

// ─── Define the agent ─────────────────────────────────────────────────────────

const agent = new VercelAIAgent({
  name: "Assistant",
  description: "A helpful general-purpose assistant",
  instructions: "You are a helpful assistant. Be concise and accurate.",
  model: ollama("gemma2:2b"),
});

// ─── Create the route handler ─────────────────────────────────────────────────

export const { POST } = createAgentRoute({
  agent,

  // Require a Bearer token — swap this for NextAuth, Clerk, etc.
  auth: bearerTokenAuth(),

  // Stream responses as SSE
  streaming: true,
});

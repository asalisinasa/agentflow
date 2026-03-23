// Provider
export { AgentProvider } from "./provider.js";
export type { AgentProviderProps } from "./provider.js";

// Hook
export { useAgent } from "./use-agent.js";

// Types
export type {
  AgentConfig,
  AgentStatus,
  Message,
  MessageRole,
  MessageStatus,
  SSEEvent,
  UseAgentReturn,
} from "./types.js";

// Components
export { ChatUI } from "./chat-ui.js";
export type { ChatUIProps } from "./chat-ui.js";

// assistant-ui adapter
export { createAssistantUIAdapter } from "./assistant-ui-adapter.js";

// Approval
export { ApprovalGate, useApproval } from "./approval.js";
export type { ApprovalGateProps, PendingApproval, UseApprovalReturn } from "./approval.js";

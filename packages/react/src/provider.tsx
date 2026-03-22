"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AgentConfig } from "./types.js";

// ─── Context ──────────────────────────────────────────────────────────────────

const AgentContext = createContext<AgentConfig | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface AgentProviderProps {
  config: AgentConfig;
  children: ReactNode;
}

/**
 * Provides agent configuration to all child components.
 *
 * Wrap your app (or a section of it) with AgentProvider to configure
 * the endpoint and auth once — useAgent() picks it up automatically.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * export default function RootLayout({ children }) {
 *   return (
 *     <AgentProvider config={{ endpoint: "/api/agent" }}>
 *       {children}
 *     </AgentProvider>
 *   )
 * }
 * ```
 */
export function AgentProvider({ config, children }: AgentProviderProps) {
  return <AgentContext.Provider value={config}>{children}</AgentContext.Provider>;
}

// ─── Hook to consume context ──────────────────────────────────────────────────

export function useAgentConfig(): AgentConfig {
  const config = useContext(AgentContext);
  if (!config) {
    throw new Error("useAgent must be used inside <AgentProvider>.");
  }
  return config;
}

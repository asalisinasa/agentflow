"use client";

import { useCallback, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PendingApproval {
  id: string;
  description: string;
  action: unknown;
}

export interface UseApprovalReturn {
  /** Current pending approval request, if any */
  pending: PendingApproval | null;
  /** Approve the current pending action */
  approve: () => Promise<void>;
  /** Reject the current pending action */
  reject: (reason?: string) => Promise<void>;
  /** Whether an approval decision is being submitted */
  isResolving: boolean;
}

// ─── useApproval ──────────────────────────────────────────────────────────────

/**
 * Hook for handling human-in-the-loop approval requests.
 *
 * Listens to SSE events from useAgent and presents approval requests.
 * When the user approves or rejects, it calls the approval API.
 *
 * @example
 * ```tsx
 * function Chat() {
 *   const { messages, send, isStreaming } = useAgent()
 *   const { pending, approve, reject } = useApproval({
 *     approvalEndpoint: "/api/agent/approval",
 *   })
 *
 *   return (
 *     <div>
 *       {pending && (
 *         <ApprovalGate
 *           request={pending}
 *           onApprove={approve}
 *           onReject={reject}
 *         />
 *       )}
 *       ...
 *     </div>
 *   )
 * }
 * ```
 */
export function useApproval(config: {
  approvalEndpoint: string;
  token?: string;
}): UseApprovalReturn & {
  /** Call this with SSE events from useAgent to detect approval requests */
  handleSSEEvent: (event: { type: string; content: unknown }) => void;
} {
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const handleSSEEvent = useCallback((event: { type: string; content: unknown }) => {
    if (event.type === "approval_required") {
      setPending(event.content as PendingApproval);
    }
  }, []);

  const resolve = useCallback(
    async (approved: boolean, reason?: string) => {
      if (!pending) return;
      setIsResolving(true);

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (config.token) headers["Authorization"] = `Bearer ${config.token}`;

        await fetch(config.approvalEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ id: pending.id, approved, reason }),
        });

        setPending(null);
      } finally {
        setIsResolving(false);
      }
    },
    [pending, config],
  );

  const approve = useCallback(() => resolve(true), [resolve]);
  const reject = useCallback((reason?: string) => resolve(false, reason), [resolve]);

  return { pending, approve, reject, isResolving, handleSSEEvent };
}

// ─── ApprovalGate component ───────────────────────────────────────────────────

export interface ApprovalGateProps {
  request: PendingApproval;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
  isResolving?: boolean;
  className?: string;
}

/**
 * A UI component that shows a pending approval request.
 *
 * Unstyled — target with data-agentsdk-approval-* attributes.
 *
 * @example
 * ```tsx
 * {pending && (
 *   <ApprovalGate
 *     request={pending}
 *     onApprove={approve}
 *     onReject={reject}
 *     isResolving={isResolving}
 *   />
 * )}
 * ```
 */
export function ApprovalGate({
  request,
  onApprove,
  onReject,
  isResolving = false,
  className,
}: ApprovalGateProps) {
  return (
    <div className={className} data-agentsdk-approval-gate="" role="alertdialog" aria-modal="true">
      <div data-agentsdk-approval-content="">
        <p data-agentsdk-approval-title="">Agent is requesting approval</p>
        <p data-agentsdk-approval-description="">{request.description}</p>
        <div data-agentsdk-approval-actions="">
          <button onClick={onApprove} disabled={isResolving} data-agentsdk-approval-approve="">
            {isResolving ? "Processing..." : "Approve"}
          </button>
          <button
            onClick={() => onReject()}
            disabled={isResolving}
            data-agentsdk-approval-reject=""
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

import type { NextRequest } from "next/server.js";

/**
 * Result of an auth check — either authenticated with a userId,
 * or unauthenticated with an optional reason.
 */
export type AuthResult =
  | { authenticated: true; userId: string }
  | { authenticated: false; reason?: string };

/**
 * A function that checks if a request is authenticated.
 * Plug in your own auth logic — NextAuth, Clerk, custom JWT, etc.
 */
export type AuthHandler = (req: NextRequest) => Promise<AuthResult> | AuthResult;

/**
 * Built-in auth handler that reads a Bearer token from the Authorization header.
 * Returns the token as the userId — useful for API key auth or testing.
 *
 * @example
 * ```ts
 * export const { POST } = createAgentRoute({
 *   agent,
 *   auth: bearerTokenAuth(),
 * })
 * ```
 */
export function bearerTokenAuth(): AuthHandler {
  return (req: NextRequest): AuthResult => {
    const header = req.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) {
      return { authenticated: false, reason: "Missing or invalid Authorization header" };
    }
    const token = header.slice(7).trim();
    if (!token) {
      return { authenticated: false, reason: "Empty token" };
    }
    return { authenticated: true, userId: token };
  };
}

/**
 * Built-in auth handler that always allows requests (no auth).
 * Use only in development or for public endpoints.
 *
 * @example
 * ```ts
 * export const { POST } = createAgentRoute({
 *   agent,
 *   auth: noAuth(),
 * })
 * ```
 */
export function noAuth(userId = "anonymous"): AuthHandler {
  return (): AuthResult => ({ authenticated: true, userId });
}

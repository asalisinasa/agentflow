import type { MemoryEntry, MemoryStore } from "@agentsdk/core";
import Supermemory from "supermemory";

/**
 * Config for SupermemoryStore.
 */
export interface SupermemoryStoreConfig {
  /**
   * Supermemory API key.
   * Defaults to SUPERMEMORY_API_KEY env variable.
   */
  apiKey?: string;

  /**
   * Optional base URL for self-hosted Supermemory instances.
   * @example "https://your-supermemory.example.com"
   */
  baseURL?: string;

  /**
   * Container tag to scope all memories to a specific user, session, or project.
   * Strongly recommended — prevents memories from leaking across users.
   * @example "user_123"
   * @example "project_abc"
   */
  containerTag?: string;

  /**
   * Max number of results returned by search().
   * @default 10
   */
  defaultSearchLimit?: number;
}

/**
 * A MemoryStore backed by Supermemory — persistent, cross-session memory with
 * built-in RAG and user profiles.
 *
 * Implements the @agentsdk/core MemoryStore interface so it drops in anywhere
 * InMemoryStore is used, with no changes to agent code.
 *
 * @example
 * ```ts
 * import { VercelAIAgent } from "@agentsdk/adapter-vercel-ai"
 * import { SupermemoryStore } from "@agentsdk/adapter-supermemory"
 * import { openai } from "@ai-sdk/openai"
 *
 * const agent = new VercelAIAgent({
 *   name: "Assistant",
 *   description: "A helpful assistant with persistent memory",
 *   instructions: "You are a helpful assistant. Use memory to personalise responses.",
 *   model: openai("gpt-4o"),
 *   memory: new SupermemoryStore({
 *     apiKey: process.env.SUPERMEMORY_API_KEY,
 *     containerTag: `user_${userId}`,
 *   }),
 * })
 * ```
 */
export class SupermemoryStore implements MemoryStore {
  private readonly client: Supermemory;
  private readonly containerTag?: string;
  private readonly defaultSearchLimit: number;

  constructor(config: SupermemoryStoreConfig = {}) {
    this.client = new Supermemory({
      apiKey: config.apiKey,
      ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
    });
    this.containerTag = config.containerTag;
    this.defaultSearchLimit = config.defaultSearchLimit ?? 10;
  }

  /**
   * Save a memory entry to Supermemory.
   */
  async save(input: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    const response = await this.client.memories.add({
      content: input.content,
      ...(this.containerTag !== undefined && { containerTags: [this.containerTag] }),
      ...(input.metadata !== undefined && { metadata: input.metadata as Record<string, string> }),
    });

    return {
      id: response.id ?? generateFallbackId(),
      content: input.content,
      metadata: input.metadata,
      createdAt: new Date(),
    };
  }

  /**
   * Search memories by semantic similarity.
   */
  async search(query: string, limit?: number): Promise<MemoryEntry[]> {
    const response = await this.client.search.memories({
      q: query,
      limit: limit ?? this.defaultSearchLimit,
      ...(this.containerTag !== undefined && { containerTag: this.containerTag }),
    });

    const results = response.results ?? [];

    return results.map((r) => ({
      id: r.id ?? generateFallbackId(),
      content: r.memory ?? "",
      metadata: r.metadata as Record<string, unknown> | undefined,
      createdAt: new Date(r.updatedAt),
    }));
  }

  /**
   * Get a memory entry by ID.
   */
  async get(id: string): Promise<MemoryEntry | null> {
    try {
      const response = await this.client.memories.get(id);
      return {
        id: response.id ?? id,
        content: response.content ?? "",
        metadata: response.metadata as Record<string, unknown> | undefined,
        createdAt: response.createdAt ? new Date(response.createdAt) : new Date(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete a memory entry by ID.
   */
  async delete(id: string): Promise<void> {
    await this.client.memories.delete(id);
  }

  /**
   * Clear all memories in the current containerTag scope.
   *
   * Note: Supermemory does not have a bulk-delete API.
   * This lists all memories and deletes them one by one.
   * For large stores, prefer scoping with containerTag and rotating tags.
   */
  async clear(): Promise<void> {
    const response = await this.client.memories.list({
      ...(this.containerTag !== undefined && { containerTags: [this.containerTag] }),
    });

    const memories = response.memories ?? [];

    await Promise.all(
      memories
        .filter((m) => m.id !== undefined)
        .map((m) => this.client.memories.delete(m.id as string)),
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateFallbackId(): string {
  return `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

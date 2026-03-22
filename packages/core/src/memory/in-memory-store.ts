import type {
  MemoryEntry,
  MemoryStore,
  Tool,
  ToolDefinition,
  ToolHandler,
} from "../types/index.js";
import { generateId } from "../utils.js";

// ─── In-memory store (dev / testing) ─────────────────────────────────────────

export class InMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>();

  async save(input: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      ...input,
      id: generateId("mem"),
      createdAt: new Date(),
    };

    this.entries.set(entry.id, entry);

    return entry;
  }

  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    const q = query.toLowerCase();

    return Array.from(this.entries.values())
      .filter((e) => e.content.toLowerCase().includes(q))
      .slice(0, limit);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

// ─── Tool builder ─────────────────────────────────────────────────────────────

export interface ToolBuilderConfig {
  name: string;
  description: string;
  parameters: ToolDefinition["parameters"];
  execute: ToolHandler;
}

export function defineTool(config: ToolBuilderConfig): Tool {
  return {
    definition: {
      name: config.name,
      description: config.description,
      parameters: config.parameters,
    },
    handler: config.execute,
  };
}

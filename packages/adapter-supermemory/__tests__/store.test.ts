import { describe, expect, it, vi, beforeEach } from "vitest";
import { SupermemoryStore } from "../src/index.js";

// ─── Mock Supermemory SDK ─────────────────────────────────────────────────────

const mockAdd = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();
const mockList = vi.fn();
const mockSearch = vi.fn();

vi.mock("supermemory", () => ({
  default: vi.fn().mockImplementation(() => ({
    memories: {
      add: mockAdd,
      get: mockGet,
      delete: mockDelete,
      list: mockList,
    },
    search: {
      documents: mockSearch,
    },
  })),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SupermemoryStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("save", () => {
    it("saves content and returns a MemoryEntry", async () => {
      mockAdd.mockResolvedValue({ id: "mem_abc123" });

      const store = new SupermemoryStore({ apiKey: "test-key" });
      const entry = await store.save({ content: "TypeScript is great" });

      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({ content: "TypeScript is great" }),
      );
      expect(entry.id).toBe("mem_abc123");
      expect(entry.content).toBe("TypeScript is great");
      expect(entry.createdAt).toBeInstanceOf(Date);
    });

    it("includes containerTag when configured", async () => {
      mockAdd.mockResolvedValue({ id: "mem_001" });

      const store = new SupermemoryStore({ apiKey: "test-key", containerTag: "user_123" });
      await store.save({ content: "hello" });

      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({ containerTags: ["user_123"] }),
      );
    });

    it("includes metadata when provided", async () => {
      mockAdd.mockResolvedValue({ id: "mem_002" });

      const store = new SupermemoryStore({ apiKey: "test-key" });
      await store.save({ content: "hello", metadata: { source: "chat" } });

      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { source: "chat" } }),
      );
    });

    it("generates fallback id when api returns no id", async () => {
      mockAdd.mockResolvedValue({});

      const store = new SupermemoryStore({ apiKey: "test-key" });
      const entry = await store.save({ content: "test" });

      expect(entry.id).toMatch(/^mem_/);
    });
  });

  describe("search", () => {
    it("returns mapped MemoryEntry array", async () => {
      mockSearch.mockResolvedValue({
        results: [
          { id: "r1", content: "TypeScript tips", createdAt: "2025-01-01T00:00:00Z" },
          { id: "r2", content: "TypeScript tricks", createdAt: "2025-01-02T00:00:00Z" },
        ],
      });

      const store = new SupermemoryStore({ apiKey: "test-key" });
      const results = await store.search("TypeScript");

      expect(results).toHaveLength(2);
      expect(results[0]?.content).toBe("TypeScript tips");
      expect(results[0]?.createdAt).toBeInstanceOf(Date);
    });

    it("uses defaultSearchLimit", async () => {
      mockSearch.mockResolvedValue({ results: [] });

      const store = new SupermemoryStore({ apiKey: "test-key", defaultSearchLimit: 5 });
      await store.search("query");

      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    });

    it("overrides limit per call", async () => {
      mockSearch.mockResolvedValue({ results: [] });

      const store = new SupermemoryStore({ apiKey: "test-key" });
      await store.search("query", 3);

      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
    });

    it("returns empty array when no results", async () => {
      mockSearch.mockResolvedValue({ results: [] });

      const store = new SupermemoryStore({ apiKey: "test-key" });
      const results = await store.search("nothing");

      expect(results).toEqual([]);
    });
  });

  describe("get", () => {
    it("returns a MemoryEntry when found", async () => {
      mockGet.mockResolvedValue({
        id: "mem_123",
        content: "remembered fact",
        createdAt: "2025-01-01T00:00:00Z",
      });

      const store = new SupermemoryStore({ apiKey: "test-key" });
      const entry = await store.get("mem_123");

      expect(entry?.id).toBe("mem_123");
      expect(entry?.content).toBe("remembered fact");
    });

    it("returns null when memory not found", async () => {
      mockGet.mockRejectedValue(new Error("Not found"));

      const store = new SupermemoryStore({ apiKey: "test-key" });
      const entry = await store.get("nonexistent");

      expect(entry).toBeNull();
    });
  });

  describe("delete", () => {
    it("calls memories.delete with correct id", async () => {
      mockDelete.mockResolvedValue(undefined);

      const store = new SupermemoryStore({ apiKey: "test-key" });
      await store.delete("mem_123");

      expect(mockDelete).toHaveBeenCalledWith("mem_123");
    });
  });

  describe("clear", () => {
    it("deletes all memories in scope", async () => {
      mockList.mockResolvedValue({
        memories: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      });
      mockDelete.mockResolvedValue(undefined);

      const store = new SupermemoryStore({ apiKey: "test-key", containerTag: "user_123" });
      await store.clear();

      expect(mockDelete).toHaveBeenCalledTimes(3);
      expect(mockDelete).toHaveBeenCalledWith("m1");
      expect(mockDelete).toHaveBeenCalledWith("m2");
      expect(mockDelete).toHaveBeenCalledWith("m3");
    });

    it("does nothing when no memories exist", async () => {
      mockList.mockResolvedValue({ memories: [] });

      const store = new SupermemoryStore({ apiKey: "test-key" });
      await store.clear();

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});

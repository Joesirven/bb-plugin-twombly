import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeLibrary, readLibrary } from "./library.js";

const canvas = (overrides: Record<string, unknown>) => ({
  id: "abc",
  name: "Example",
  url: "https://twombly.app/c/example-one",
  frames: 2,
  favorite: false,
  createdAt: 1_000,
  updatedAt: 2_000,
  thumbnailUrl: "/thumb/abcdefghjkmn.webp?v=1a2b3c4d5e6f782d",
  ...overrides,
});

describe("normalizeLibrary", () => {
  it("keeps online canvases once, marks shared ones, and sorts newest first", () => {
    const result = normalizeLibrary(
      {
        canvases: [
          canvas({ name: "Older", updatedAt: 10 }),
          canvas({ id: "local", name: "Local copy", url: "http://localhost:4747/c/x" }),
          canvas({ id: "here", name: "Duplicate", updatedAt: 99 }),
          canvas({ name: "Newer", url: "https://twombly.app/c/example-two", updatedAt: 50, thumbnailUrl: "/thumb/../etc.webp" }),
        ],
        shared: [
          canvas({ name: "From a teammate", url: "https://twombly.app/c/example-three", updatedAt: 30 }),
          canvas({ name: "Older again", updatedAt: 1 }),
        ],
      },
      { me: { id: "user-1", email: "person@example.com", name: null } },
    );
    expect(result.account).toEqual({ id: "user-1", email: "person@example.com", name: null });
    expect(result.canvases.map((item) => [item.name, item.shared])).toEqual([
      ["Newer", false],
      ["From a teammate", true],
      ["Older", false],
    ]);
    expect(result.canvases[0]!.thumbnailPath).toBeNull();
    expect(result.canvases[2]!.thumbnailPath).toBe("/thumb/abcdefghjkmn.webp?v=1a2b3c4d5e6f782d");
  });
  it("rejects a changed service response instead of storing bad data", () => {
    expect(() =>
      normalizeLibrary({ canvases: [{ name: "No link" }], shared: [] }, { me: null }),
    ).toThrow();
  });
});

describe("readLibrary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("reports a stopped service without running Twombly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await expect(readLibrary(new AbortController().signal)).resolves.toEqual({ running: false });
  });
});

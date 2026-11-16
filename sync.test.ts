import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { HostLibrary, LibraryCanvas } from "./library.js";
import { MIGRATIONS, createLibraryStore } from "./store.js";
import { createLibrarySync } from "./sync.js";

function makeStore() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return createLibraryStore(db);
}

const canvas = (name: string, updatedAt: number, shared = false): LibraryCanvas => ({
  url: `https://twombly.app/c/${name.toLowerCase().replaceAll(" ", "-")}`,
  name,
  frames: 1,
  favorite: false,
  shared,
  createdAt: 1,
  updatedAt,
  thumbnailPath: `/thumb/${name.slice(0, 1).toLowerCase().repeat(12)}.webp`,
});

describe("library sync", () => {
  it("stores the signed-in account, fetches only changed thumbnails, and records other hosts", async () => {
    const store = makeStore();
    let library: HostLibrary = {
      running: true,
      account: { id: "user-1", email: "person@example.com", name: null },
      canvases: [canvas("Alpha", 10), canvas("Beta", 20, true)],
    };
    const readThumbnails = vi.fn(async (_hostId: string, paths: string[]) =>
      paths.map((path) => ({ path, dataUrl: `data:image/webp;base64,${path.length}` })),
    );
    const refresh = createLibrarySync({
      store,
      listHosts: async () => [
        { id: "mac", name: "Mac" },
        { id: "down", name: "Down" },
      ],
      readLibrary: async (hostId) => {
        if (hostId === "down") throw new Error("host offline");
        return library;
      },
      readThumbnails,
      now: () => 500,
      warn: () => {},
    });
    await refresh();
    const state = store.state();
    expect(state.accounts[0]!.canvases.map((item) => item.name)).toEqual(["Beta", "Alpha"]);
    expect(state.hosts.map((host) => [host.hostName, host.status])).toEqual([
      ["Down", "unreachable"],
      ["Mac", "signed-in"],
    ]);
    expect(readThumbnails).toHaveBeenCalledTimes(1);
    expect(store.thumbnails([canvas("Alpha", 10).url])).toHaveLength(1);

    library = { ...library, canvases: [canvas("Alpha", 10), canvas("Beta", 21, true)] };
    await refresh();
    expect(readThumbnails).toHaveBeenCalledTimes(2);
    expect(readThumbnails.mock.calls[1]![1]).toEqual([canvas("Beta", 21).thumbnailPath]);

    library = { ...library, canvases: [canvas("Alpha", 10)] };
    await refresh();
    expect(store.state().accounts[0]!.canvases.map((item) => item.name)).toEqual(["Alpha"]);
    expect(store.findCanvas("alp").map((item) => item.name)).toEqual(["Alpha"]);
    expect(store.findCanvas(canvas("Alpha", 10).url)).toHaveLength(1);
  });
  it("records a signed-out host without dropping stored canvases", async () => {
    const store = makeStore();
    store.replaceAccount({ id: "user-1", email: null, name: "Person" }, [canvas("Alpha", 1)], 1);
    const refresh = createLibrarySync({
      store,
      listHosts: async () => [{ id: "mac", name: "Mac" }],
      readLibrary: async () => ({ running: true, account: null, canvases: [] }),
      readThumbnails: async () => [],
      now: () => 2,
      warn: () => {},
    });
    await refresh();
    const state = store.state();
    expect(state.hosts[0]!.status).toBe("signed-out");
    expect(state.accounts[0]!.canvases).toHaveLength(1);
  });
});

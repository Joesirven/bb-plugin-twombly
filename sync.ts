import type { Account, HostLibrary, LibraryCanvas } from "./library.js";
import type { LibraryStore } from "./store.js";

const THUMBNAIL_BATCH = 8;

export interface SyncHost {
  id: string;
  name: string;
}
export interface SyncDeps {
  store: LibraryStore;
  listHosts(): Promise<SyncHost[]>;
  readLibrary(hostId: string): Promise<HostLibrary>;
  readThumbnails(
    hostId: string,
    paths: string[],
  ): Promise<{ path: string; dataUrl: string | null }[]>;
  now(): number;
  warn(message: string): void;
}

interface SourcedCanvas {
  canvas: LibraryCanvas;
  host: SyncHost;
}
interface MergedAccount {
  account: Account;
  canvases: Map<string, SourcedCanvas>;
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function better(current: SourcedCanvas, next: SourcedCanvas) {
  if (next.canvas.updatedAt !== current.canvas.updatedAt)
    return next.canvas.updatedAt > current.canvas.updatedAt ? next : current;
  return !current.canvas.thumbnailPath && next.canvas.thumbnailPath
    ? next
    : current;
}

async function readHost(
  deps: SyncDeps,
  host: SyncHost,
): Promise<Extract<HostLibrary, { running: true }> | null> {
  const checkedAt = deps.now();
  const record = (
    status: "signed-in" | "signed-out" | "not-running" | "unreachable",
    accountId: string | null,
    error: string | null,
  ) =>
    deps.store.recordHost({
      hostId: host.id,
      hostName: host.name,
      status,
      accountId,
      checkedAt,
      error,
    });
  let library: HostLibrary;
  try {
    library = await deps.readLibrary(host.id);
  } catch (cause) {
    record("unreachable", null, message(cause));
    return null;
  }
  if (!library.running) {
    record("not-running", null, null);
    return null;
  }
  if (!library.account) {
    record("signed-out", null, null);
    return null;
  }
  record("signed-in", library.account.id, null);
  return library;
}

async function fetchThumbnails(deps: SyncDeps, merged: MergedAccount) {
  const stale = deps.store.staleThumbnails(merged.account.id);
  const byHost = new Map<string, { host: SyncHost; items: typeof stale }>();
  for (const item of stale) {
    const source = merged.canvases.get(item.url);
    if (!source || source.canvas.thumbnailPath !== item.path) continue;
    const group = byHost.get(source.host.id) ?? {
      host: source.host,
      items: [],
    };
    group.items.push(item);
    byHost.set(source.host.id, group);
  }
  await Promise.all(
    [...byHost.values()].map(async ({ host, items }) => {
      for (let index = 0; index < items.length; index += THUMBNAIL_BATCH) {
        const batch = items.slice(index, index + THUMBNAIL_BATCH);
        try {
          const results = await deps.readThumbnails(
            host.id,
            batch.map((item) => item.path),
          );
          for (const item of batch) {
            const found = results.find((result) => result.path === item.path);
            if (found?.dataUrl)
              deps.store.saveThumbnail(item.url, item.updatedAt, found.dataUrl);
          }
        } catch (cause) {
          deps.warn(
            `Twombly thumbnails failed on ${host.name}: ${message(cause)}`,
          );
          return;
        }
      }
    }),
  );
}

export function createLibrarySync(deps: SyncDeps) {
  let running: Promise<void> | null = null;
  async function refreshOnce() {
    const hosts = await deps.listHosts();
    const libraries = await Promise.all(
      hosts.map(async (host) => ({ host, library: await readHost(deps, host) })),
    );
    const accounts = new Map<string, MergedAccount>();
    for (const { host, library } of libraries) {
      if (!library?.account) continue;
      const merged = accounts.get(library.account.id) ?? {
        account: library.account,
        canvases: new Map<string, SourcedCanvas>(),
      };
      for (const canvas of library.canvases) {
        const next = { canvas, host };
        const current = merged.canvases.get(canvas.url);
        merged.canvases.set(canvas.url, current ? better(current, next) : next);
      }
      accounts.set(library.account.id, merged);
    }
    const at = deps.now();
    for (const merged of accounts.values()) {
      deps.store.replaceAccount(
        merged.account,
        [...merged.canvases.values()].map((item) => item.canvas),
        at,
      );
    }
    await Promise.all(
      [...accounts.values()].map((merged) => fetchThumbnails(deps, merged)),
    );
  }
  return function refresh() {
    running ??= refreshOnce().finally(() => {
      running = null;
    });
    return running;
  };
}

import type { HostLibrary } from "./library.js";
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

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

async function syncHost(deps: SyncDeps, host: SyncHost) {
  const checkedAt = deps.now();
  let library: HostLibrary;
  try {
    library = await deps.readLibrary(host.id);
  } catch (cause) {
    deps.store.recordHost({
      hostId: host.id,
      hostName: host.name,
      status: "unreachable",
      accountId: null,
      checkedAt,
      error: message(cause),
    });
    return;
  }
  if (!library.running || !library.account) {
    deps.store.recordHost({
      hostId: host.id,
      hostName: host.name,
      status: library.running ? "signed-out" : "not-running",
      accountId: null,
      checkedAt,
      error: null,
    });
    return;
  }
  deps.store.replaceAccount(library.account, library.canvases, checkedAt);
  deps.store.recordHost({
    hostId: host.id,
    hostName: host.name,
    status: "signed-in",
    accountId: library.account.id,
    checkedAt,
    error: null,
  });
  const stale = deps.store.staleThumbnails(library.account.id);
  for (let index = 0; index < stale.length; index += THUMBNAIL_BATCH) {
    const batch = stale.slice(index, index + THUMBNAIL_BATCH);
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
      deps.warn(`Twombly thumbnails failed on ${host.name}: ${message(cause)}`);
      return;
    }
  }
}

export function createLibrarySync(deps: SyncDeps) {
  let running: Promise<void> | null = null;
  return function refresh() {
    running ??= (async () => {
      try {
        const hosts = await deps.listHosts();
        await Promise.all(hosts.map((host) => syncHost(deps, host)));
      } finally {
        running = null;
      }
    })();
    return running;
  };
}

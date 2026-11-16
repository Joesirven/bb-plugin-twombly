import type { z } from "zod";
import type { libraryStateSchema } from "./contract.js";
import type { Account, LibraryCanvas } from "./library.js";

type LibraryState = z.infer<typeof libraryStateSchema>;
type HostStatus = LibraryState["hosts"][number];

interface Statement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface StoreDatabase {
  prepare(sql: string): Statement;
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void;
}

export const MIGRATIONS = [
  `CREATE TABLE twombly_accounts (
    id TEXT PRIMARY KEY,
    email TEXT,
    name TEXT,
    refreshed_at INTEGER NOT NULL
  )`,
  `CREATE TABLE twombly_canvases (
    account_id TEXT NOT NULL,
    url TEXT NOT NULL,
    name TEXT NOT NULL,
    frames INTEGER NOT NULL,
    favorite INTEGER NOT NULL,
    shared INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    thumbnail_path TEXT,
    PRIMARY KEY (account_id, url)
  )`,
  `CREATE TABLE twombly_thumbnails (
    url TEXT PRIMARY KEY,
    updated_at INTEGER NOT NULL,
    data_url TEXT NOT NULL
  )`,
  `CREATE TABLE twombly_hosts (
    host_id TEXT PRIMARY KEY,
    host_name TEXT NOT NULL,
    status TEXT NOT NULL,
    account_id TEXT,
    checked_at INTEGER NOT NULL,
    error TEXT
  )`,
];

interface CanvasRow {
  account_id: string;
  url: string;
  name: string;
  frames: number;
  favorite: number;
  shared: number;
  created_at: number;
  updated_at: number;
  thumbnail_path: string | null;
}
interface AccountRow {
  id: string;
  email: string | null;
  name: string | null;
  refreshed_at: number;
}
interface HostRow {
  host_id: string;
  host_name: string;
  status: HostStatus["status"];
  account_id: string | null;
  checked_at: number;
  error: string | null;
}

function toCanvas(row: CanvasRow): LibraryCanvas {
  return {
    url: row.url,
    name: row.name,
    frames: row.frames,
    favorite: row.favorite === 1,
    shared: row.shared === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbnailPath: row.thumbnail_path,
  };
}

export function createLibraryStore(db: StoreDatabase) {
  const replaceAccount = db.transaction(
    (account: Account, canvases: LibraryCanvas[], at: number) => {
      db.prepare(
        `INSERT INTO twombly_accounts (id, email, name, refreshed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, refreshed_at = excluded.refreshed_at`,
      ).run(account.id, account.email, account.name, at);
      db.prepare(`DELETE FROM twombly_canvases WHERE account_id = ?`).run(
        account.id,
      );
      const insert = db.prepare(
        `INSERT INTO twombly_canvases (account_id, url, name, frames, favorite, shared, created_at, updated_at, thumbnail_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const canvas of canvases) {
        insert.run(
          account.id,
          canvas.url,
          canvas.name,
          canvas.frames,
          canvas.favorite ? 1 : 0,
          canvas.shared ? 1 : 0,
          canvas.createdAt,
          canvas.updatedAt,
          canvas.thumbnailPath,
        );
      }
    },
  );
  return {
    replaceAccount,
    recordHost(host: HostStatus) {
      db.prepare(
        `INSERT INTO twombly_hosts (host_id, host_name, status, account_id, checked_at, error) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (host_id) DO UPDATE SET host_name = excluded.host_name, status = excluded.status,
           account_id = excluded.account_id, checked_at = excluded.checked_at, error = excluded.error`,
      ).run(
        host.hostId,
        host.hostName,
        host.status,
        host.accountId,
        host.checkedAt,
        host.error,
      );
    },
    staleThumbnails(accountId: string) {
      return (
        db
          .prepare(
            `SELECT c.url, c.thumbnail_path, c.updated_at FROM twombly_canvases c
             LEFT JOIN twombly_thumbnails t ON t.url = c.url
             WHERE c.account_id = ? AND c.thumbnail_path IS NOT NULL
               AND (t.url IS NULL OR t.updated_at <> c.updated_at)`,
          )
          .all(accountId) as {
          url: string;
          thumbnail_path: string;
          updated_at: number;
        }[]
      ).map((row) => ({
        url: row.url,
        path: row.thumbnail_path,
        updatedAt: row.updated_at,
      }));
    },
    saveThumbnail(url: string, updatedAt: number, dataUrl: string) {
      db.prepare(
        `INSERT INTO twombly_thumbnails (url, updated_at, data_url) VALUES (?, ?, ?)
         ON CONFLICT (url) DO UPDATE SET updated_at = excluded.updated_at, data_url = excluded.data_url`,
      ).run(url, updatedAt, dataUrl);
    },
    thumbnails(urls: string[]) {
      if (urls.length === 0) return [];
      return (
        db
          .prepare(
            `SELECT url, data_url FROM twombly_thumbnails WHERE url IN (${urls.map(() => "?").join(", ")})`,
          )
          .all(...urls) as { url: string; data_url: string }[]
      ).map((row) => ({ url: row.url, dataUrl: row.data_url }));
    },
    state(): LibraryState {
      const accounts = db
        .prepare(
          `SELECT id, email, name, refreshed_at FROM twombly_accounts ORDER BY refreshed_at DESC`,
        )
        .all() as AccountRow[];
      const canvases = db
        .prepare(
          `SELECT * FROM twombly_canvases ORDER BY updated_at DESC`,
        )
        .all() as CanvasRow[];
      const hosts = db
        .prepare(`SELECT * FROM twombly_hosts ORDER BY host_name`)
        .all() as HostRow[];
      return {
        accounts: accounts.map((account) => ({
          id: account.id,
          email: account.email,
          name: account.name,
          refreshedAt: account.refreshed_at,
          canvases: canvases
            .filter((row) => row.account_id === account.id)
            .map(toCanvas),
        })),
        hosts: hosts.map((host) => ({
          hostId: host.host_id,
          hostName: host.host_name,
          status: host.status,
          accountId: host.account_id,
          checkedAt: host.checked_at,
          error: host.error,
        })),
        refreshedAt: hosts.reduce<number | null>(
          (latest, host) =>
            latest === null || host.checked_at > latest
              ? host.checked_at
              : latest,
          null,
        ),
      };
    },
    findCanvas(query: string) {
      const rows = db
        .prepare(
          `SELECT * FROM twombly_canvases WHERE url = ? OR lower(name) = lower(?) ORDER BY updated_at DESC`,
        )
        .all(query, query) as CanvasRow[];
      if (rows.length > 0) return rows.map(toCanvas);
      return (
        db
          .prepare(
            `SELECT * FROM twombly_canvases WHERE instr(lower(name), lower(?)) > 0 ORDER BY updated_at DESC LIMIT 10`,
          )
          .all(query) as CanvasRow[]
      ).map(toCanvas);
    },
  };
}

export type LibraryStore = ReturnType<typeof createLibraryStore>;

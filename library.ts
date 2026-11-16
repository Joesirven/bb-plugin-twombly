import { z } from "zod";

export const DAEMON_ORIGIN = "http://127.0.0.1:4747";
const THUMBNAIL_PATH = /^\/thumb\/[a-z2-9]{12}\.webp(\?v=[A-Za-z0-9_-]{1,64})?$/;
const MAX_THUMBNAIL_BYTES = 256 * 1024;

const daemonCanvasSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  url: z.string().min(1),
  frames: z.number().int().nonnegative(),
  favorite: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  thumbnailUrl: z.string().nullable().optional(),
});
const daemonCanvasesSchema = z.object({
  canvases: z.array(daemonCanvasSchema),
  shared: z.array(daemonCanvasSchema),
});
const daemonBootstrapSchema = z.object({
  me: z
    .object({
      id: z.string().min(1),
      email: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .nullable(),
});

export const accountSchema = z.object({
  id: z.string().min(1),
  email: z.string().nullable(),
  name: z.string().nullable(),
});
export const libraryCanvasSchema = z.object({
  url: z.url(),
  name: z.string(),
  frames: z.number().int().nonnegative(),
  favorite: z.boolean(),
  shared: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  thumbnailPath: z.string().regex(THUMBNAIL_PATH).nullable(),
});
export const hostLibrarySchema = z.discriminatedUnion("running", [
  z.object({ running: z.literal(false) }),
  z.object({
    running: z.literal(true),
    account: accountSchema.nullable(),
    canvases: z.array(libraryCanvasSchema),
  }),
]);
export const thumbnailsInputSchema = z
  .object({ paths: z.array(z.string().regex(THUMBNAIL_PATH)).max(12) })
  .strict();
export const thumbnailsOutputSchema = z.array(
  z.object({ path: z.string(), dataUrl: z.string().nullable() }),
);

export type Account = z.infer<typeof accountSchema>;
export type LibraryCanvas = z.infer<typeof libraryCanvasSchema>;
export type HostLibrary = z.infer<typeof hostLibrarySchema>;

function onlineUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === "https://twombly.app" && url.pathname.length > 1
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function normalizeLibrary(
  canvasesBody: unknown,
  bootstrapBody: unknown,
): Extract<HostLibrary, { running: true }> {
  const listed = daemonCanvasesSchema.parse(canvasesBody);
  const { me } = daemonBootstrapSchema.parse(bootstrapBody);
  const byUrl = new Map<string, LibraryCanvas>();
  const add = (
    entries: z.infer<typeof daemonCanvasSchema>[],
    shared: boolean,
  ) => {
    for (const entry of entries) {
      const url = onlineUrl(entry.url);
      if (!url || byUrl.has(url)) continue;
      const thumbnail = entry.thumbnailUrl ?? null;
      byUrl.set(url, {
        url,
        name: entry.name,
        frames: entry.frames,
        favorite: entry.favorite ?? false,
        shared,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        thumbnailPath:
          thumbnail && THUMBNAIL_PATH.test(thumbnail) ? thumbnail : null,
      });
    }
  };
  add(listed.canvases, false);
  add(listed.shared, true);
  return {
    running: true,
    account: me
      ? { id: me.id, email: me.email ?? null, name: me.name ?? null }
      : null,
    canvases: [...byUrl.values()].sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

async function daemonJson(path: string, signal: AbortSignal) {
  const response = await fetch(DAEMON_ORIGIN + path, { signal });
  if (!response.ok)
    throw new Error(`Twombly answered ${response.status} for ${path}.`);
  return response.json();
}

export async function readLibrary(signal: AbortSignal): Promise<HostLibrary> {
  try {
    const health = await fetch(`${DAEMON_ORIGIN}/health`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
    });
    if (!health.ok) return { running: false };
  } catch {
    signal.throwIfAborted();
    return { running: false };
  }
  const [canvases, bootstrap] = await Promise.all([
    daemonJson("/api/canvases", signal),
    daemonJson("/api/bootstrap", signal),
  ]);
  return normalizeLibrary(canvases, bootstrap);
}

export async function readThumbnails(paths: string[], signal: AbortSignal) {
  return Promise.all(
    paths.map(async (path) => {
      try {
        const response = await fetch(DAEMON_ORIGIN + path, { signal });
        const type = response.headers.get("content-type") ?? "";
        if (!response.ok || !type.startsWith("image/"))
          return { path, dataUrl: null };
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > MAX_THUMBNAIL_BYTES) return { path, dataUrl: null };
        return {
          path,
          dataUrl: `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`,
        };
      } catch {
        signal.throwIfAborted();
        return { path, dataUrl: null };
      }
    }),
  );
}

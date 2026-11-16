import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type ExperimentalThreadActionTabProps,
} from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { libraryStateSchema, rpcContract } from "./contract.js";
import type { LibraryCanvas } from "./library.js";

type LibraryState = z.infer<typeof libraryStateSchema>;
type ViewMode = "grid" | "list";
const VIEW_KEY = "twombly.library.view";

const canvasSchema = z.object({
  link: z
    .url()
    .refine((value) => new URL(value).origin === "https://twombly.app"),
});

const baseButton =
  "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
const primaryButton = `${baseButton} bg-primary text-primary-foreground hover:bg-primary/90`;
const outlineButton = `${baseButton} border border-border bg-transparent hover:bg-accent hover:text-accent-foreground`;

function TwomblyPanel({ threadId }: ExperimentalThreadActionTabProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("beginLogin", { threadId });
      setSignedIn(result.signedIn);
      if (!result.signedIn && !navigate.openUrl(result.url))
        throw new Error("BB could not open sign-in.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function openCanvas() {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("run", {
        threadId,
        args: ["init", "--no-open"],
      });
      if (result.exitCode !== 0)
        throw new Error(result.stderr || result.stdout);
      const canvas = canvasSchema.parse(JSON.parse(result.stdout));
      if (!navigate.openUrl(canvas.link))
        throw new Error("BB could not open the canvas link.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-4 p-4">
      <h2 className="text-base font-medium">Twombly</h2>
      <p className="text-sm text-muted-foreground">
        Review working screens and full page captures on your project canvas.
      </p>
      <button
        type="button"
        className={primaryButton}
        disabled={busy}
        onClick={() => void openCanvas()}
      >
        {busy ? "Opening canvas…" : "Open project canvas"}
      </button>
      <button
        type="button"
        className={outlineButton}
        disabled={busy}
        onClick={() => void signIn()}
      >
        {signedIn ? "Check sign-in" : "Sign in to Twombly"}
      </button>
      {signedIn && (
        <p role="status" className="text-sm">
          This machine is signed in to Twombly.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        In the BB desktop browser, use the Apple Passwords key button on the
        Google sign-in page. Confirm the selected login on your Mac.
      </p>
      <p className="text-sm text-muted-foreground">
        Sign in on the Mac that runs this thread. After login, select Sign in
        again to check the result.
      </p>
      <p className="text-sm text-muted-foreground">
        Twombly checks for its latest release when a command runs. Frames upload
        to your private online canvas. Share only when you are ready.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}


function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function formatDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function uniqueCanvases(state: LibraryState | null) {
  const seen = new Set<string>();
  const result: LibraryCanvas[] = [];
  for (const account of state?.accounts ?? [])
    for (const canvas of account.canvases)
      if (!seen.has(canvas.url)) {
        seen.add(canvas.url);
        result.push(canvas);
      }
  return result;
}

function CanvasCard({
  canvas,
  view,
  thumbnail,
  onOpen,
}: {
  canvas: LibraryCanvas;
  view: ViewMode;
  thumbnail: string | undefined;
  onOpen: () => void;
}) {
  const detail = `${canvas.frames} ${canvas.frames === 1 ? "frame" : "frames"} · ${formatDate(canvas.updatedAt)}`;
  const image = thumbnail ? (
    <img src={thumbnail} alt="" className="h-full w-full object-cover" />
  ) : (
    <span className="text-xs text-muted-foreground">No preview</span>
  );
  if (view === "list")
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
      >
        <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
          {image}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {canvas.favorite ? "★ " : ""}
            {canvas.name}
          </span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
      </button>
    );
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col overflow-hidden rounded-lg border border-border text-left hover:border-primary"
    >
      <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
        {image}
      </span>
      <span className="flex flex-col gap-0.5 p-2">
        <span className="truncate text-sm font-medium">
          {canvas.favorite ? "★ " : ""}
          {canvas.name}
        </span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function CanvasLibraryPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [state, setState] = useState<LibraryState | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [view, setView] = useState<ViewMode>(readView);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setState(await rpc.call("library", {}));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("library", () => {
    void load();
  });
  const canvases = uniqueCanvases(state);
  const missing = canvases
    .filter((canvas) => canvas.thumbnailPath && !(canvas.url in thumbnails))
    .map((canvas) => canvas.url);
  const missingKey = missing.join(" ");
  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const found: Record<string, string> = {};
      for (let index = 0; index < missing.length; index += 100) {
        const rows = await rpc.call("thumbnails", {
          urls: missing.slice(index, index + 100),
        });
        for (const row of rows) found[row.url] = row.dataUrl;
      }
      for (const url of missing) found[url] ??= "";
      if (!cancelled) setThumbnails((current) => ({ ...current, ...found }));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [missingKey, rpc]);
  function chooseView(next: ViewMode) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  }
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setState(await rpc.call("refreshLibrary", {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  function open(canvas: LibraryCanvas) {
    if (!navigate.openUrl(canvas.url))
      setError(`BB could not open ${canvas.name}.`);
  }
  const query = filter.trim().toLowerCase();
  const visible = query
    ? canvases.filter((canvas) => canvas.name.toLowerCase().includes(query))
    : canvases;
  const groups = [
    { title: "Your canvases", items: visible.filter((canvas) => !canvas.shared) },
    { title: "Shared with you", items: visible.filter((canvas) => canvas.shared) },
  ];
  const accounts = (state?.accounts ?? [])
    .map((account) => account.email ?? account.name ?? account.id)
    .join(", ");
  const signedIn = (state?.hosts ?? []).some(
    (host) => host.status === "signed-in",
  );
  const toggle = (mode: ViewMode, label: string) => (
    <button
      type="button"
      aria-pressed={view === mode}
      onClick={() => chooseView(mode)}
      className={`h-8 px-3 text-sm ${view === mode ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"}`}
    >
      {label}
    </button>
  );
  return (
    <section className="flex h-full flex-col gap-4 overflow-auto p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-medium">Twombly canvases</h1>
          <p className="text-sm text-muted-foreground">
            {accounts || "No signed-in Twombly account yet"}
            {state?.refreshedAt
              ? ` · refreshed ${new Date(state.refreshedAt).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name"
          className="h-8 w-48 rounded-md border border-border bg-transparent px-2 text-sm"
        />
        <div className="flex overflow-hidden rounded-md border border-border">
          {toggle("grid", "Grid")}
          {toggle("list", "List")}
        </div>
        <button
          type="button"
          className={outlineButton}
          disabled={busy}
          onClick={() => void refresh()}
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {state && !signedIn && canvases.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No machine reports a signed-in Twombly account. Open the Twombly tab
          in a thread and select Sign in to Twombly, then select Refresh.
        </p>
      )}
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <div key={group.title} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              {group.title} ({group.items.length})
            </h2>
            <div
              className={
                view === "grid"
                  ? "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
                  : "flex flex-col"
              }
            >
              {group.items.map((canvas) => (
                <CanvasCard
                  key={canvas.url}
                  canvas={canvas}
                  view={view}
                  thumbnail={thumbnails[canvas.url] || undefined}
                  onOpen={() => open(canvas)}
                />
              ))}
            </div>
          </div>
        ),
      )}
    </section>
  );
}

const canvasTab = {
  id: "canvas",
  context: { kind: "thread" },
  availability: "action",
} as const;

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "canvases",
    title: "Twombly",
    icon: "Palette",
    path: "canvases",
    component: CanvasLibraryPanel,
  });
  app.slots.experimental_tab({
    ...canvasTab,
    title: "Twombly",
    icon: "Palette",
    component: TwomblyPanel,
  });
  app.commands.register({
    id: "open-canvas",
    title: "Open Twombly",
    isAvailable: ({ threadId }) => threadId !== null,
    run: (context) => {
      context.experimental_panel.openTab({ tab: canvasTab });
    },
  });
});

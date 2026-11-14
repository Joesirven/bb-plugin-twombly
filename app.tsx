import { useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  type ExperimentalThreadActionTabProps,
} from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { rpcContract } from "./contract.js";

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

const canvasTab = {
  id: "canvas",
  context: { kind: "thread" },
  availability: "action",
} as const;

export default definePluginApp((app) => {
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

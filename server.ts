import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { argumentsSchema, hostContract, rpcContract } from "./contract.js";
import type { LibraryCanvas } from "./library.js";
import { MIGRATIONS, createLibraryStore } from "./store.js";
import { createLibrarySync } from "./sync.js";

const LIBRARY_COMMANDS = ["library", "library-refresh", "library-open"];

function describeCanvas(canvas: LibraryCanvas) {
  const updated = new Date(canvas.updatedAt).toISOString().slice(0, 10);
  const owner = canvas.shared ? "shared with you" : "yours";
  return `- ${canvas.name}: ${canvas.url} (${canvas.frames} frames, ${owner}, updated ${updated})`;
}

function uniqueByUrl(canvases: LibraryCanvas[]) {
  const seen = new Set<string>();
  return canvases.filter((canvas) => {
    if (seen.has(canvas.url)) return false;
    seen.add(canvas.url);
    return true;
  });
}

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = createLibraryStore(db);
  const sync = createLibrarySync({
    store,
    async listHosts() {
      const hosts = await bb.sdk.hosts.list();
      return hosts
        .filter((item) => item.status === "connected")
        .map((item) => ({ id: item.id, name: item.name }));
    },
    readLibrary: (hostId) =>
      host.call("library", {}, { hostId, timeoutMs: 25_000 }),
    readThumbnails: (hostId, paths) =>
      host.call("thumbnails", { paths }, { hostId, timeoutMs: 35_000 }),
    now: () => Date.now(),
    warn: (text) => bb.log.warn(text),
  });
  async function refreshLibrary() {
    await sync();
    bb.realtime.publish("library", { refreshedAt: Date.now() });
    return store.state();
  }
  function libraryText(query: string | null) {
    const state = store.state();
    const canvases = uniqueByUrl(
      query
        ? store.findCanvas(query)
        : state.accounts.flatMap((account) => account.canvases),
    );
    const accounts = state.accounts
      .map((account) => account.email ?? account.name ?? account.id)
      .join(", ");
    const header = state.refreshedAt
      ? `Twombly canvases for ${accounts || "no signed-in account"}, refreshed ${new Date(state.refreshedAt).toISOString()}.`
      : "The Twombly canvas list has not been refreshed yet. Run bb twombly library-refresh.";
    if (canvases.length === 0)
      return `${header}\nNo canvases match${query ? ` "${query}"` : ""}.`;
    return [header, ...canvases.map(describeCanvas)].join("\n");
  }
  async function openCanvas(threadId: string, query: string) {
    const matches = uniqueByUrl(store.findCanvas(query));
    if (matches.length === 0)
      throw new Error(
        `No Twombly canvas matches "${query}". List them with twombly_library.`,
      );
    if (matches.length > 1 && matches[0]!.name.toLowerCase() !== query.toLowerCase() && matches[0]!.url !== query)
      throw new Error(
        `Several canvases match "${query}":\n${matches.map(describeCanvas).join("\n")}\nUse the exact name or link.`,
      );
    const canvas = matches[0]!;
    const hosts = (await bb.sdk.hosts.list()).filter(
      (item) => item.status === "connected",
    );
    for (const item of hosts) {
      try {
        const { instances } =
          await bb.sdk.experimental_desktopBrowsers.listInstances({
            hostId: item.id,
          });
        const instance = instances[0];
        if (!instance) continue;
        await bb.sdk.experimental_desktopBrowsers.createTab({
          hostId: instance.hostId,
          instanceId: instance.instanceId,
          generation: instance.generation,
          threadId,
          url: canvas.url,
          presentation: "reveal",
        });
        return { canvas, opened: true };
      } catch (cause) {
        bb.log.warn(
          `Opening ${canvas.url} in the BB browser on ${item.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
    return { canvas, opened: false };
  }
  function openText(result: Awaited<ReturnType<typeof openCanvas>>) {
    return result.opened
      ? `Opened ${result.canvas.name} in the BB browser: ${result.canvas.url}`
      : `No BB desktop browser is available. Give the user this link as a markdown link: [${result.canvas.name}](${result.canvas.url})`;
  }
  bb.background.schedule("library-refresh", "*/10 * * * *", async () => {
    await refreshLibrary();
  });
  void refreshLibrary().catch((cause) =>
    bb.log.warn(
      `Twombly library refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    ),
  );
  async function environmentFor(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId)
      throw new Error("This thread has no execution environment.");
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (!environment.path)
      throw new Error("This thread has no workspace path.");
    return { cwd: environment.path, hostId: environment.hostId };
  }
  async function run(threadId: string, args: string[], signal?: AbortSignal) {
    const environment = await environmentFor(threadId);
    if (args[0] === "login") {
      if (args.length !== 1)
        throw new Error("Run bb twombly login without arguments.");
      const login = await host.call(
        "beginLogin",
        { cwd: environment.cwd },
        { hostId: environment.hostId, signal, timeoutMs: 90_000 },
      );
      return { exitCode: 0, stdout: JSON.stringify(login), stderr: "" };
    }
    return host.call(
      "run",
      { cwd: environment.cwd, args },
      {
        hostId: environment.hostId,
        signal: signal ?? AbortSignal.timeout(6 * 60_000),
        timeoutMs: 6 * 60_000,
      },
    );
  }
  bb.rpc.register(rpcContract, {
    library: () => store.state(),
    refreshLibrary: () => refreshLibrary(),
    thumbnails: ({ urls }) => store.thumbnails(urls),
    run: ({ threadId, args }) => run(threadId, args),
    async beginLogin({ threadId }) {
      const environment = await environmentFor(threadId);
      return host.call(
        "beginLogin",
        { cwd: environment.cwd },
        { hostId: environment.hostId, timeoutMs: 90_000 },
      );
    },
  });
  bb.cli.register({
    name: "twombly",
    summary: "Run the latest Twombly in this thread's workspace",
    commands: [
      {
        name: "guide",
        summary: "Read the current upstream guide",
        usage: "bb twombly guide",
      },
      {
        name: "init",
        summary: "Create or join a private canvas",
        usage: "bb twombly init [--name NAME] [--canvas NAME]",
      },
      {
        name: "capture",
        summary: "Capture a full page into static HTML",
        usage:
          "bb twombly capture URL --out FOLDER [--width WIDTH] [--height HEIGHT]",
      },
      {
        name: "login",
        summary:
          "Get a sign-in link for the execution machine; open it in the BB desktop browser",
        usage: "bb twombly login",
      },
      {
        name: "library",
        summary: "List every canvas the signed-in Twombly account can see, from the BB server's stored list",
        usage: "bb twombly library [NAME]",
      },
      {
        name: "library-refresh",
        summary: "Read the canvas list again from every connected machine",
        usage: "bb twombly library-refresh",
      },
      {
        name: "library-open",
        summary: "Open a canvas from the stored list in the BB browser",
        usage: "bb twombly library-open NAME_OR_LINK",
      },
      {
        name: "help",
        summary: "List current upstream commands",
        usage: "bb twombly help",
      },
    ],
    async run(argv, context) {
      const [command, ...rest] = argv;
      if (command && LIBRARY_COMMANDS.includes(command)) {
        if (command === "library-refresh") await refreshLibrary();
        if (command !== "library-open")
          return {
            exitCode: 0,
            stdout: libraryText(rest.join(" ").trim() || null),
          };
        if (!context.threadId)
          return {
            exitCode: 1,
            stderr: "Run library-open from a BB thread so BB knows where to open the canvas.",
          };
        const query = rest.join(" ").trim();
        if (!query)
          return { exitCode: 1, stderr: "Name the canvas to open." };
        return {
          exitCode: 0,
          stdout: openText(await openCanvas(context.threadId, query)),
        };
      }
      if (!context.threadId)
        return {
          exitCode: 1,
          stderr:
            "Run this command from a BB thread so its execution machine and workspace are known.",
        };
      return run(
        context.threadId,
        argumentsSchema.parse(argv.length ? argv : ["help"]),
        context.signal,
      );
    },
  });
  bb.agents.registerTool({
    name: "twombly_run",
    description:
      "Use Twombly for live design frames, full page captures, selected-frame context and comments. Read guide first. Arguments are a string array passed without a shell to the latest Twombly on this thread's machine.",
    parameters: z.object({ args: argumentsSchema }).strict(),
    async execute({ args }, context) {
      const result = await run(context.threadId, args, context.signal);
      return {
        content: [
          {
            type: "text",
            text: [result.stdout, result.stderr].filter(Boolean).join("\n"),
          },
        ],
        isError: result.exitCode !== 0,
      };
    },
  });
  bb.agents.registerTool({
    name: "twombly_library",
    description:
      "List every Twombly canvas the signed-in account owns or that others share with it, from the list BB keeps on its server. Optionally filter by name.",
    parameters: z
      .object({ query: z.string().min(1).max(200).optional() })
      .strict(),
    async execute({ query }) {
      return {
        content: [{ type: "text", text: libraryText(query ?? null) }],
        isError: false,
      };
    },
  });
  bb.agents.registerTool({
    name: "twombly_open_canvas",
    description:
      "Open a Twombly canvas from the stored list in the user's BB desktop browser, by exact name, part of the name, or link. If no desktop browser is available, it returns the link to give the user.",
    parameters: z.object({ canvas: z.string().min(1).max(500) }).strict(),
    async execute({ canvas }, context) {
      try {
        return {
          content: [
            {
              type: "text",
              text: openText(await openCanvas(context.threadId, canvas)),
            },
          ],
          isError: false,
        };
      } catch (cause) {
        return {
          content: [
            {
              type: "text",
              text: cause instanceof Error ? cause.message : String(cause),
            },
          ],
          isError: true,
        };
      }
    },
  });
  bb.agents.configure(() => ({
    tools: ["twombly_run", "twombly_library", "twombly_open_canvas"],
    skills: ["twombly"],
    instructions:
      'Twombly is enabled. Use its skill for design explorations, side-by-side versions and reviewable page captures. Prefer working static frames, then full page HTML captures; use PNG images only when necessary. Start with twombly_run args ["guide"]. Use twombly_library to find any canvas the signed-in account can see, and twombly_open_canvas to open one in BB. Read context when the user refers to selected frames, and comments when reviewing feedback. Open the canvas link in BB. Never read credentials or automate Touch ID. Share only on explicit request.',
  }));
}

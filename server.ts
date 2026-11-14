import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { argumentsSchema, hostContract, rpcContract } from "./contract.js";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
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
        name: "help",
        summary: "List current upstream commands",
        usage: "bb twombly help",
      },
    ],
    async run(argv, context) {
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
  bb.agents.configure(() => ({
    tools: ["twombly_run"],
    skills: ["twombly"],
    instructions:
      'Twombly is enabled. Use its skill for design explorations, side-by-side versions and reviewable page captures. Prefer working static frames, then full page HTML captures; use PNG images only when necessary. Start with twombly_run args ["guide"]. Read context when the user refers to selected frames, and comments when reviewing feedback. Open the canvas link in BB. Never read credentials or automate Touch ID. Share only on explicit request.',
  }));
}

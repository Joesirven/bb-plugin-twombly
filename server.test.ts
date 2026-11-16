import {
  createFakePluginHost,
  makeHostResponse,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";

describe("Twombly plugin", () => {
  it("contributes its skill and tool only through the enabled plugin lifecycle", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "twombly",
      agentSkillIds: ["twombly"],
    });
    try {
      plugin(bb);
      const config = await harness.behavior.resolveAgentConfiguration(
        makePluginAgentConfigurationContext(),
      );
      expect(JSON.stringify(config)).toContain("twombly_run");
      expect(JSON.stringify(config)).toContain("full page HTML captures");
    } finally {
      await harness.lifecycle.dispose();
    }
  });
  it("refuses a CLI call without a thread instead of running on the server", async () => {
    const callHost = vi.fn();
    const { bb, harness } = createFakePluginHost({
      pluginId: "twombly",
      agentSkillIds: ["twombly"],
      experimental_callHostRpc: callHost,
    });
    try {
      plugin(bb);
      const result = await harness.behavior.runCli(["init"]);
      expect(result.exitCode).toBe(1);
      expect(callHost).not.toHaveBeenCalled();
    } finally {
      await harness.lifecycle.dispose();
    }
  });
  it("routes to the environment host and propagates upstream failure", async () => {
    const callHost = vi.fn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "Frame rejected",
    }));
    const { bb, harness } = createFakePluginHost({
      pluginId: "twombly",
      agentSkillIds: ["twombly"],
      experimental_callHostRpc: callHost,
    });
    harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({ environmentId: "environment-mac" }),
    );
    harness.sdk.stub("environments.get", async () => ({
      path: "/workspace/design",
      hostId: "mac",
    }));
    try {
      plugin(bb);
      const result = await harness.behavior.callRpc("run", {
        threadId: "thread-test",
        args: ["check", "out"],
      });
      expect(result).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "Frame rejected",
      });
      expect(callHost).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "mac",
          input: { cwd: "/workspace/design", args: ["check", "out"] },
        }),
      );
    } finally {
      await harness.lifecycle.dispose();
    }
  });
  it("lists the stored canvases and gives a link when no BB browser can open one", async () => {
    const callHost = vi.fn(async ({ method }: { method: string }) =>
      method === "library"
        ? {
            running: true,
            account: { id: "user-1", email: "person@example.com", name: null },
            canvases: [
              {
                url: "https://twombly.app/c/example-board",
                name: "Example board",
                frames: 3,
                favorite: false,
                shared: true,
                createdAt: 1,
                updatedAt: 2,
                thumbnailPath: null,
              },
            ],
          }
        : [],
    );
    const { bb, harness } = createFakePluginHost({
      pluginId: "twombly",
      agentSkillIds: ["twombly"],
      experimental_callHostRpc: callHost,
    });
    harness.sdk.stub("hosts.list", async () => [
      makeHostResponse({ id: "mac", name: "Mac", status: "connected" }),
    ]);
    harness.sdk.stub("experimental_desktopBrowsers.listInstances", async () => ({
      instances: [],
    }));
    try {
      plugin(bb);
      const listed = await harness.behavior.runCli(["library-refresh"]);
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).toContain("Example board: https://twombly.app/c/example-board");
      expect(listed.stdout).toContain("shared with you");
      const asObject = (value: unknown) => {
        if (typeof value === "string") throw new Error("Expected a structured result.");
        return value as { isError: boolean; content: unknown };
      };
      const opened = asObject(await harness.behavior.callAgentTool(
        "twombly_open_canvas",
        { canvas: "example" },
        { threadId: "thread-test" },
      ));
      expect(opened.isError).toBe(false);
      expect(JSON.stringify(opened.content)).toContain(
        "[Example board](https://twombly.app/c/example-board)",
      );
      const missing = asObject(await harness.behavior.callAgentTool(
        "twombly_open_canvas",
        { canvas: "nothing like this" },
        { threadId: "thread-test" },
      ));
      expect(missing.isError).toBe(true);
    } finally {
      await harness.lifecycle.dispose();
    }
  });
});

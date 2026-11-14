import {
  createFakePluginHost,
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
});

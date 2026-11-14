import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterEach, describe, expect, it, vi } from "vitest";
import entry from "./host.js";
import { runTwombly } from "./runner.js";

vi.mock("./runner.js", () => ({ runTwombly: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("Twombly host sign-in", () => {
  it("does not contact the local login endpoint when startup fails", async () => {
    vi.mocked(runTwombly).mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "Registry unavailable",
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const harness = experimental_createHostEntryHarness(entry);
    try {
      await expect(
        harness.experimental_call("beginLogin", { cwd: "/workspace" }),
      ).rejects.toThrow("could not start");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await harness.experimental_dispose();
    }
  });
  it("rejects an unexpected login response after an upstream change", async () => {
    vi.mocked(runTwombly).mockResolvedValue({
      exitCode: 0,
      stdout: "{}",
      stderr: "",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          signedIn: false,
          url: "https://unexpected.invalid/login",
        }),
      ),
    );
    const harness = experimental_createHostEntryHarness(entry);
    try {
      await expect(
        harness.experimental_call("beginLogin", { cwd: "/workspace" }),
      ).rejects.toThrow();
    } finally {
      await harness.experimental_dispose();
    }
  });
});

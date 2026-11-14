import { PassThrough } from "node:stream";
import { ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTwombly } from "./runner.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

function childProcess() {
  return Object.assign(new ChildProcess(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
}

afterEach(() => vi.resetAllMocks());

describe("Twombly command lifecycle", () => {
  it("rejects oversized output instead of clipping successful JSON", async () => {
    const child = childProcess();
    vi.mocked(spawn).mockImplementation(() => child);
    const result = runTwombly("/tmp", ["help"], new AbortController().signal);
    child.stdout.write(Buffer.alloc(512 * 1024 + 1));
    child.emit("close", 0);
    await expect(result).rejects.toThrow("exceeded");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("stops an active child when its caller cancels", async () => {
    const child = childProcess();
    vi.mocked(spawn).mockImplementation(() => child);
    const controller = new AbortController();
    const result = runTwombly(
      "/tmp",
      ["capture", "http://localhost"],
      controller.signal,
    );
    controller.abort(new Error("Thread stopped"));
    await expect(result).rejects.toThrow("Thread stopped");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", null);
  });
  it("reports a missing package runner", async () => {
    const child = childProcess();
    vi.mocked(spawn).mockImplementation(() => child);
    const result = runTwombly("/tmp", ["help"], new AbortController().signal);
    child.emit("error", new Error("spawn npx ENOENT"));
    await expect(result).rejects.toThrow("ENOENT");
  });
});

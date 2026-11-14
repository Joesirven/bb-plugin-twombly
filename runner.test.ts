import { describe, expect, it } from "vitest";
import { commandArguments, runTwombly } from "./runner.js";

describe("Twombly execution boundary", () => {
  it("resolves latest online and preserves shell metacharacters as arguments", () => {
    expect(
      commandArguments([
        "add",
        "a folder",
        "--title",
        "$(touch /tmp/unwanted)",
      ]),
    ).toEqual([
      "--yes",
      "--prefer-online",
      "--package=twombly@latest",
      "--",
      "twombly",
      "add",
      "a folder",
      "--title",
      "$(touch /tmp/unwanted)",
    ]);
  });
  it("opens canvases through BB without launching a browser on the execution host", () => {
    expect(commandArguments(["init", "--name", "Review"]).at(-1)).toBe(
      "--no-open",
    );
    expect(
      commandArguments([
        "join",
        "https://twombly.app/example",
        "--no-open",
      ]).filter((arg) => arg === "--no-open"),
    ).toHaveLength(1);
  });
  it.each(["--package=other", "__daemon", "mcp", "hooks", "upgrade"])(
    "refuses npm options and unmanaged integration command %s",
    (command) => {
      expect(() => commandArguments([command])).toThrow();
    },
  );
  it("rejects a relative workspace before spawning anything", async () => {
    await expect(
      runTwombly("relative", ["help"], new AbortController().signal),
    ).rejects.toThrow("absolute workspace");
  });
  it("does not start an already cancelled command", async () => {
    await expect(
      runTwombly("/tmp", ["help"], AbortSignal.abort()),
    ).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { daemonOrigin, twomblyPort } from "./port.js";

describe("Twombly port", () => {
  it("uses 4747 when TWOMBLY_PORT is not set", () => {
    expect(twomblyPort({})).toBe(4747);
    expect(daemonOrigin({})).toBe("http://127.0.0.1:4747");
  });
  it("uses TWOMBLY_PORT for a second machine user", () => {
    expect(twomblyPort({ TWOMBLY_PORT: "4748" })).toBe(4748);
    expect(daemonOrigin({ TWOMBLY_PORT: " 4748 " })).toBe("http://127.0.0.1:4748");
  });
  it.each(["80", "70000", "47a7", "-1"])("rejects %s", (value) => {
    expect(() => twomblyPort({ TWOMBLY_PORT: value })).toThrow(/TWOMBLY_PORT/);
  });
});

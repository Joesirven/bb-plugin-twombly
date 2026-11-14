import { describe, expect, it } from "vitest";
import { loginSchema } from "./contract.js";

describe("Twombly sign-in boundary", () => {
  it("accepts only the upstream machine sign-in page", () => {
    const url =
      "https://twombly.app/auth/machine/start?state=test&challenge=test&port=4747";
    expect(loginSchema.parse({ signedIn: false, url })).toEqual({
      signedIn: false,
      url,
    });
  });
  it.each([
    "https://twombly.app.attacker.test/auth/machine/start",
    "javascript:alert(1)",
    "http://twombly.app/auth/machine/start",
    "https://twombly.app/other",
  ])("rejects unexpected authentication destinations: %s", (url) => {
    expect(loginSchema.safeParse({ signedIn: false, url }).success).toBe(false);
  });
  it("strips account details from an already signed-in response", () => {
    expect(
      loginSchema.parse({
        signedIn: true,
        me: { email: "test@example.invalid" },
      }),
    ).toEqual({ signedIn: true });
  });
});

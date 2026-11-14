import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const argumentsSchema = z.array(z.string().max(100_000)).min(1).max(128);
export const resultSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});
export const loginSchema = z.discriminatedUnion("signedIn", [
  z.object({ signedIn: z.literal(true) }),
  z.object({
    signedIn: z.literal(false),
    url: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.origin === "https://twombly.app" &&
        url.pathname === "/auth/machine/start" &&
        !url.username &&
        !url.password &&
        url.searchParams.get("port") === "4747" &&
        !!url.searchParams.get("state") &&
        !!url.searchParams.get("challenge")
      );
    }),
  }),
]);
export const hostContract = defineRpcContract({
  beginLogin: {
    input: z.object({ cwd: z.string().min(1) }).strict(),
    output: loginSchema,
  },
  run: {
    input: z.object({ cwd: z.string().min(1), args: argumentsSchema }).strict(),
    output: resultSchema,
  },
});
export const rpcContract = defineRpcContract({
  beginLogin: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: loginSchema,
  },
  run: {
    input: z
      .object({ threadId: z.string().min(1), args: argumentsSchema })
      .strict(),
    output: resultSchema,
  },
});

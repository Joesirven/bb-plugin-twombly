import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  accountSchema,
  hostLibrarySchema,
  libraryCanvasSchema,
  thumbnailsInputSchema,
  thumbnailsOutputSchema,
} from "./library.js";

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
export const libraryHostSchema = z.object({
  hostId: z.string(),
  hostName: z.string(),
  status: z.enum(["signed-in", "signed-out", "not-running", "unreachable"]),
  accountId: z.string().nullable(),
  checkedAt: z.number(),
  error: z.string().nullable(),
});
export const libraryAccountSchema = accountSchema.extend({
  canvases: z.array(libraryCanvasSchema),
  refreshedAt: z.number(),
});
export const libraryStateSchema = z.object({
  accounts: z.array(libraryAccountSchema),
  hosts: z.array(libraryHostSchema),
  refreshedAt: z.number().nullable(),
});
export const hostContract = defineRpcContract({
  library: {
    input: z.object({}).strict(),
    output: hostLibrarySchema,
  },
  thumbnails: {
    input: thumbnailsInputSchema,
    output: thumbnailsOutputSchema,
  },
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
  library: {
    input: z.object({}).strict(),
    output: libraryStateSchema,
  },
  refreshLibrary: {
    input: z.object({}).strict(),
    output: libraryStateSchema,
  },
  thumbnails: {
    input: z.object({ urls: z.array(z.url()).max(100) }).strict(),
    output: z.array(z.object({ url: z.string(), dataUrl: z.string() })),
  },
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

import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract, loginSchema } from "./contract.js";
import { readLibrary, readThumbnails } from "./library.js";
import { runTwombly } from "./runner.js";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    library: (_input, context) =>
      readLibrary(
        AbortSignal.any([
          context.signal,
          context.lifecycle.signal,
          AbortSignal.timeout(20_000),
        ]),
      ),
    thumbnails: ({ paths }, context) =>
      readThumbnails(
        paths,
        AbortSignal.any([
          context.signal,
          context.lifecycle.signal,
          AbortSignal.timeout(30_000),
        ]),
      ),
    async beginLogin({ cwd }, context) {
      const signal = AbortSignal.any([
        context.signal,
        context.lifecycle.signal,
        AbortSignal.timeout(90_000),
      ]);
      const ready = await runTwombly(cwd, ["status"], signal);
      if (ready.exitCode !== 0)
        throw new Error(
          "Twombly could not start. Run bb twombly status for details.",
        );
      const response = await fetch("http://127.0.0.1:4747/cli/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, app: "bb" }),
        signal,
      });
      if (!response.ok)
        throw new Error(
          "Twombly could not start sign-in. Use bb twombly login.",
        );
      return loginSchema.parse(await response.json());
    },
    run: ({ cwd, args }, context) =>
      runTwombly(
        cwd,
        args,
        AbortSignal.any([
          context.signal,
          context.lifecycle.signal,
          AbortSignal.timeout(6 * 60_000),
        ]),
      ),
  },
});

import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

const MAX_OUTPUT_BYTES = 512 * 1024;

export function commandArguments(args: string[]) {
  if (!args[0] || args[0].startsWith("-") || args[0].startsWith("__")) {
    throw new Error("Supply a public Twombly command, such as guide or init.");
  }
  if (["mcp", "hooks", "upgrade"].includes(args[0])) {
    throw new Error(
      "BB manages this integration. Use guide for supported canvas commands.",
    );
  }
  const normalized = [...args];
  if (["init", "join"].includes(args[0]) && !args.includes("--no-open")) {
    normalized.push("--no-open");
  }
  return [
    "--yes",
    "--prefer-online",
    "--package=twombly@latest",
    "--",
    "twombly",
    ...normalized,
  ];
}

export async function runTwombly(
  cwd: string,
  args: string[],
  signal: AbortSignal,
) {
  if (!isAbsolute(cwd))
    throw new Error("Twombly requires an absolute workspace path.");
  signal.throwIfAborted();
  const command = commandArguments(args);
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn("npx", command, {
        cwd,
        env: {
          ...process.env,
          TWOMBLY_APP: "bb",
          TWOMBLY_NO_OPEN: "1",
          TWOMBLY_PORT: "4747",
          TWOMBLY_ENDPOINT: "https://twombly.app",
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const stop = () => {
        if (process.platform !== "win32" && child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else child.kill("SIGKILL");
      };
      const abort = () => {
        stop();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let overflow = false;
      const collect = (target: Buffer[], chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) {
          overflow = true;
          stop();
        } else target.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.once("error", (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      });
      child.once("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (overflow)
          return reject(
            new Error("Twombly output exceeded 512 KiB. Narrow the command."),
          );
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    },
  );
}

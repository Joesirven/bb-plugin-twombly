export const DEFAULT_PORT = 4747;

/** Twombly's background service port for this machine user.
 * Set TWOMBLY_PORT in the BB host daemon's environment when several
 * operating-system users run Twombly on one machine. Each user needs a
 * different port, because the service listens on the shared loopback address. */
export function twomblyPort(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.TWOMBLY_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535)
    throw new Error(`TWOMBLY_PORT must be a whole number from 1024 to 65535, not "${raw}".`);
  return port;
}

export function daemonOrigin(env: NodeJS.ProcessEnv = process.env) {
  return `http://127.0.0.1:${twomblyPort(env)}`;
}

export function isPortText(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return false;
  const port = Number(value);
  return port >= 1024 && port <= 65535;
}

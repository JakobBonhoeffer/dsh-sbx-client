/**
 * Pure helpers for addresses and login tokens. No Electron or Node imports on purpose, so the
 * logic can be exercised on its own.
 */

import type { SandboxPortBinding } from '../shared/sandbox'

/** Only bindings on this address are offered: the app talks to sandboxes through the local loopback. */
export const LOOPBACK_IPV4 = '127.0.0.1'

/**
 * Returns the address to reconnect to after a sandbox start: the last address the app connected
 * to, if it points to one of the sandbox's published loopback ports. Otherwise null.
 */
export function pickAutoConnectUrl(lastUrl: string | null, ports: readonly SandboxPortBinding[]): string | null {
  if (lastUrl === null) return null
  let url: URL
  try {
    url = new URL(lastUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || url.hostname !== LOOPBACK_IPV4) return null
  const port = Number(url.port)
  return ports.some((binding) => binding.hostPort === port) ? url.href : null
}

/** Placeholder in the login command that is replaced by the port published on this computer. */
export const PORT_PLACEHOLDER = '{port}'

/** Replaces every `{port}` in the command. The port is a validated integer, never free text. */
export function applyPortPlaceholder(command: string, hostPort: number): string {
  return command.split(PORT_PLACEHOLDER).join(String(hostPort))
}

/**
 * Finds the launch token in the output of the login command. The command may print a full URL
 * (`http://127.0.0.1:3080/?token=...`) or just `token=...`; both work. If the output contains
 * several tokens (a log with several starts), the last one wins. Anything else in the output
 * is ignored, so the output can never influence where the app connects to.
 */
export function extractToken(output: string): string | null {
  const matches = Array.from(output.matchAll(/token=([A-Za-z0-9_-]{1,512})/g))
  const last = matches[matches.length - 1]
  return last?.[1] ?? null
}

/** Builds the address to open: the published port on this computer plus the token. */
export function buildLoginUrl(hostPort: number, token: string): string {
  return `http://${LOOPBACK_IPV4}:${hostPort}/?token=${token}`
}

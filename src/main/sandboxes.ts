import {
  isValidPort,
  isValidSandboxName,
  type SandboxInfo,
  type SandboxMount,
  type SandboxPortBinding
} from '../shared/sandbox'
import { applyPortPlaceholder, extractToken, LOOPBACK_IPV4 } from './address'
import { parseMount } from './mounts'
import { runSbx, SbxError } from './sbx'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function parsePorts(value: unknown): SandboxPortBinding[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ports: SandboxPortBinding[] = []
  for (const item of value) {
    const entry = asRecord(item)
    if (!entry || entry['host_ip'] !== LOOPBACK_IPV4) continue
    const hostPort = entry['host_port']
    const sandboxPort = entry['sandbox_port']
    if (typeof hostPort !== 'number' || typeof sandboxPort !== 'number') continue
    if (!isValidPort(hostPort) || !isValidPort(sandboxPort)) continue
    // sbx lists the same mapping once per protocol; show it once.
    const key = `${hostPort}:${sandboxPort}`
    if (seen.has(key)) continue
    seen.add(key)
    ports.push({ hostPort, sandboxPort })
  }
  return ports.sort((a, b) => a.hostPort - b.hostPort)
}

function parseMounts(value: unknown): SandboxMount[] {
  if (!Array.isArray(value)) return []
  const mounts: SandboxMount[] = []
  for (const item of value) {
    const mount = typeof item === 'string' ? parseMount(item) : null
    if (mount) mounts.push(mount)
  }
  return mounts
}

function parseSandbox(value: unknown): SandboxInfo | null {
  const entry = asRecord(value)
  if (!entry) return null
  const name = entry['name']
  if (typeof name !== 'string' || !isValidSandboxName(name)) return null
  const status = typeof entry['status'] === 'string' ? entry['status'] : 'unknown'
  return {
    name,
    agent: typeof entry['agent'] === 'string' ? entry['agent'] : '',
    status,
    running: status === 'running',
    ports: parsePorts(entry['ports']),
    mounts: parseMounts(entry['mounts'])
  }
}

/** Starting boots a microVM and runs its startup hooks, so it gets a generous limit. */
const START_TIMEOUT_MS = 180_000
const STOP_TIMEOUT_MS = 60_000

/**
 * Starts an existing sandbox without opening a session (`--detach`). The caller must have
 * checked that the sandbox exists: `sbx run` would otherwise try to create one.
 */
export async function startSandbox(name: string): Promise<void> {
  if (!isValidSandboxName(name)) throw new SbxError('Invalid sandbox name.', 'failed')
  await runSbx(['run', '--name', name, '--detach'], { timeoutMs: START_TIMEOUT_MS })
}

export async function stopSandbox(name: string): Promise<void> {
  if (!isValidSandboxName(name)) throw new SbxError('Invalid sandbox name.', 'failed')
  await runSbx(['stop', name], { timeoutMs: STOP_TIMEOUT_MS })
}

const LOGIN_COMMAND_TIMEOUT_MS = 20_000

/**
 * Runs the user's token command inside a running sandbox and returns the launch token it prints.
 *
 * The command comes from the Settings (typed by the user) and runs inside the sandbox, never on
 * this computer: `sbx exec <name> sh -c <command>`. Only the token is taken from the output; the
 * address is always built by the caller from the published port. Output is never logged because
 * it contains a credential. Throws SbxError.
 */
export async function fetchLoginToken(name: string, command: string, hostPort: number): Promise<string> {
  if (!isValidSandboxName(name)) throw new SbxError('Invalid sandbox name.', 'failed')
  let output: string
  try {
    output = await runSbx(['exec', name, 'sh', '-c', applyPortPlaceholder(command, hostPort)], {
      timeoutMs: LOGIN_COMMAND_TIMEOUT_MS
    })
  } catch (error) {
    if (error instanceof SbxError && error.kind === 'failed') {
      // runSbx masks tokens as "token=…"; a message that is only that carries no information.
      const detail = error.message.includes('token=…') ? '' : `: ${error.message}`
      throw new SbxError(`The token command failed${detail}`, 'failed')
    }
    throw error
  }
  const token = extractToken(output)
  if (token === null) {
    throw new SbxError('The token command did not print a token (expected something like token=…).', 'failed')
  }
  return token
}

/** Lists local sandboxes via `sbx ls --format json`. Throws SbxError. */
export async function listSandboxes(): Promise<SandboxInfo[]> {
  const output = (await runSbx(['ls', '--format', 'json'])).trim()
  // An empty list may be printed as nothing or as null.
  if (output === '' || output === 'null') return []

  let data: unknown
  try {
    data = JSON.parse(output)
  } catch {
    throw new SbxError('Unexpected output from "sbx ls".', 'failed')
  }
  if (!Array.isArray(data)) {
    throw new SbxError('Unexpected output from "sbx ls".', 'failed')
  }

  return data
    .map(parseSandbox)
    .filter((sandbox): sandbox is SandboxInfo => sandbox !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

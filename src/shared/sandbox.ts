/** Contract between the main process and the Sandboxes window. */

/** A published port that is reachable on the IPv4 loopback address of this machine. */
export interface SandboxPortBinding {
  hostPort: number
  sandboxPort: number
}

/** A folder (or single file) of this computer that is mounted into the sandbox. */
export interface SandboxMount {
  /** Path on this computer. */
  hostPath: string
  /** Where it appears inside the sandbox. */
  sandboxPath: string
  readOnly: boolean
}

export interface SandboxInfo {
  name: string
  agent: string
  /** Raw status reported by sbx, for example "running" or "stopped". */
  status: string
  running: boolean
  ports: SandboxPortBinding[]
  mounts: SandboxMount[]
}

export type SandboxListResult =
  /** `loginAvailable` is true when a token command is configured in the Settings. */
  | { ok: true; sandboxes: SandboxInfo[]; loginAvailable: boolean }
  | { ok: false; message: string }

export type ActionResult = { ok: true } | { ok: false; message: string }

export interface SandboxApi {
  list: () => Promise<SandboxListResult>
  /** Connects the main window to a port published by a running sandbox. */
  connect: (name: string, hostPort: number) => Promise<ActionResult>
  /**
   * Like `connect`, but first runs the token command from the Settings inside the sandbox and
   * opens the address with the token it prints (needed when the saved session has expired).
   */
  connectWithLogin: (name: string, hostPort: number) => Promise<ActionResult>
  /**
   * Starts a stopped sandbox. If the main window was last connected to a port of this sandbox,
   * it reconnects automatically once the web UI answers (the dialog then closes by itself).
   */
  start: (name: string) => Promise<ActionResult>
  /** Stops a running sandbox. Disconnects the main window first if it shows that sandbox. */
  stop: (name: string) => Promise<ActionResult>
  /** Opens the "Copy files" dialog for a running sandbox (replaces this dialog). */
  openTransfer: (name: string) => Promise<ActionResult>
  /** Opens the Files dialog (file browser) for a running sandbox (replaces this dialog). */
  openExplorer: (name: string) => Promise<ActionResult>
  /** Opens the Logs dialog (log viewer) for a running sandbox (replaces this dialog). */
  openLogs: (name: string) => Promise<ActionResult>
  /** Opens the Templates dialog for a sandbox (running or stopped; replaces this dialog). */
  openTemplates: (name: string) => Promise<ActionResult>
  /** Shows a folder that is mounted into the sandbox in the file explorer of this computer. */
  openMount: (name: string, hostPath: string) => Promise<ActionResult>
  /** Closes this dialog. */
  close: () => Promise<void>
}

export const SANDBOX_IPC = {
  list: 'sandbox:list',
  connect: 'sandbox:connect',
  connectWithLogin: 'sandbox:connect-with-login',
  start: 'sandbox:start',
  stop: 'sandbox:stop',
  openTransfer: 'sandbox:open-transfer',
  openMount: 'sandbox:open-mount',
  openExplorer: 'sandbox:open-explorer',
  openLogs: 'sandbox:open-logs',
  openTemplates: 'sandbox:open-templates'
} as const

/**
 * Sandbox names end up as command-line arguments, so only a conservative character set is
 * accepted. Both sbx output and renderer input are checked with this.
 */
export function isValidSandboxName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

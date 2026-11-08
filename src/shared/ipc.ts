/**
 * Contract between the main process and the local "chrome" view (toolbar + status panel).
 * The remote view never gets this API: it has no preload script at all.
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionState {
  status: ConnectionStatus
  /** Address shown in the input field. Never contains a launch token. */
  url: string
  /** Human-readable detail for the 'error' status, otherwise null. */
  message: string | null
}

export interface SbxClientApi {
  getState: () => Promise<ConnectionState>
  connect: (url: string) => Promise<void>
  /** Closes the remote page. With `signOut`, the stored session cookie is deleted as well. */
  disconnect: (options: { signOut: boolean }) => Promise<void>
  /** Subscribes to state changes. Returns an unsubscribe function. */
  onState: (listener: (state: ConnectionState) => void) => () => void
  /** Opens (or focuses) the Sandboxes window. */
  openSandboxes: () => Promise<void>
  /** Opens (or focuses) the Settings window. */
  openSettings: () => Promise<void>
  /**
   * Opens a native popup menu below a title bar button. `x` and `y` are the bottom-left corner
   * of the button in window coordinates.
   */
  openMenu: (menu: MenuKey, x: number, y: number) => Promise<void>
}

/** Menus shown as buttons in the title bar. */
export type MenuKey = 'application' | 'view'

export function isMenuKey(value: unknown): value is MenuKey {
  return value === 'application' || value === 'view'
}

export const IPC = {
  getState: 'connection:get-state',
  connect: 'connection:connect',
  disconnect: 'connection:disconnect',
  state: 'connection:state',
  openSandboxes: 'windows:open-sandboxes',
  openSettings: 'windows:open-settings',
  openMenu: 'menu:open'
} as const

/**
 * Suggested address when nothing was saved yet: the default listen address of `dsh web`.
 * If the host is published under a different port, the user types it once and it is remembered.
 */
export const DEFAULT_URL = 'http://127.0.0.1:3080/'

/** Contract between the main process and the Settings window. */

import { DEFAULT_LOG_LEVEL, type LogLevel } from './logging'

export const DEFAULT_SBX_PATH = 'sbx'

/** Sandbox logs shown in the log viewer have launch tokens masked unless this is switched off. */
export const DEFAULT_MASK_TOKENS = true

export { DEFAULT_LOG_LEVEL }

/** Empty means: the "Connect with login" button is not offered. */
export const DEFAULT_TOKEN_COMMAND = ''

const MAX_TOKEN_COMMAND_LENGTH = 2000

/** Settings the user can edit in the Settings dialog. */
export interface AppSettings {
  /** Name or full path of the Docker Sandboxes CLI. */
  sbxPath: string
  /**
   * Optional shell command that is run inside the chosen sandbox to obtain the launch token of
   * the web UI. `{port}` is replaced by the port published on this computer.
   */
  tokenCommand: string
  /** How much the app writes to its own log file. */
  logLevel: LogLevel
  /** Mask `token=…` in sandbox logs shown by the log viewer. (The app's own log is always masked.) */
  maskTokens: boolean
}

/** Where the app's own log files are. */
export interface LogInfo {
  /** The log folder, or null if logging has not started. */
  directory: string | null
  /** True when the folder next to the app could not be used and the per-user folder is used instead. */
  fallback: boolean
}

export type SaveResult = { ok: true; settings: AppSettings } | { ok: false; message: string }

export interface SbxTestResult {
  ok: boolean
  /** Version line on success, otherwise the reason. */
  message: string
}

export interface AboutInfo {
  name: string
  version: string
}

export interface SettingsApi {
  get: () => Promise<AppSettings>
  save: (settings: AppSettings) => Promise<SaveResult>
  /** Runs `<path> version` so the user can check a path before saving it. */
  testSbx: (sbxPath: string) => Promise<SbxTestResult>
  about: () => Promise<AboutInfo>
  /** Where the app's own log files are. */
  logInfo: () => Promise<LogInfo>
  /** Opens the log folder in the file explorer. */
  openLogFolder: () => Promise<{ ok: true } | { ok: false; message: string }>
  /** Closes this dialog. */
  close: () => Promise<void>
}

export const SETTINGS_IPC = {
  get: 'settings:get',
  save: 'settings:save',
  testSbx: 'settings:test-sbx',
  about: 'settings:about',
  logInfo: 'settings:log-info',
  openLogFolder: 'settings:open-log-folder'
} as const

/** Returns an error message, or null when the value is acceptable. Empty is allowed. */
export function validateTokenCommand(value: string): string | null {
  if (value.length > MAX_TOKEN_COMMAND_LENGTH) return 'The command is too long.'
  // One line only; tabs are fine.
  if (/[\u0000-\u0008\u000a-\u001f]/.test(value)) return 'The command must be a single line without control characters.'
  return null
}

/** Returns an error message, or null when the value is acceptable. Used by both sides. */
export function validateSbxPath(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'Enter the name or path of the sbx executable.'
  if (trimmed.length > 1024) return 'The path is too long.'
  if (/[\u0000-\u001f]/.test(trimmed)) return 'The path contains invalid characters.'
  return null
}

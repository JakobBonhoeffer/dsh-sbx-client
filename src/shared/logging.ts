/**
 * Pure helpers for logging: levels, masking of secrets, line format and file rotation. No Electron
 * or Node imports on purpose, so everything here can be exercised on its own and is shared by the
 * logger (main process) and the log viewer.
 */

/** From most to least important. A message is written when its level is at or above the chosen one. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const DEFAULT_LOG_LEVEL: LogLevel = 'info'

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value)
}

/** True when a message of level `message` is recorded while the configured level is `configured`. */
export function levelAllows(configured: LogLevel, message: LogLevel): boolean {
  return LOG_LEVELS.indexOf(message) <= LOG_LEVELS.indexOf(configured)
}

/**
 * Replaces the value of every launch token (`token=<value>`) with `token=…`. The launch token is
 * the only credential this app handles; it appears in start-up URLs of the DSH web UI.
 */
export function maskSecrets(text: string): string {
  return text.replace(/token=[A-Za-z0-9_-]+/g, 'token=…')
}

/**
 * One log line: `2026-11-08T21:50:12.345Z INFO  [scope] message`. Line breaks inside the message
 * become the two characters `\n`, so every entry is exactly one line. Secrets are always masked.
 */
export function formatLogLine(date: Date, level: LogLevel, scope: string, message: string): string {
  const flat = maskSecrets(message).replace(/\r?\n/g, '\\n')
  return `${date.toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${flat}`
}

/** The plain name of the current log file, and the pattern of rotated ones. */
export const LOG_BASE_NAME = 'dsh-sbx-client'
export const LOG_EXTENSION = '.log'

/** Maximum size of one log file before it is rotated, and how many files are kept in total. */
export const LOG_MAX_BYTES = 5 * 1024 * 1024
export const LOG_KEEP_FILES = 5

/**
 * The steps that make room for a new log file: the oldest rotated file is removed, the others move
 * one number up and the current file becomes `.1`. With keep = 5 the files are
 * `dsh-sbx-client.log` (current) and `dsh-sbx-client.1.log` to `dsh-sbx-client.4.log`.
 */
export function rotationSteps(keep: number): { remove: string; renames: Array<[string, string]> } {
  const rotated = (n: number): string => `${LOG_BASE_NAME}.${n}${LOG_EXTENSION}`
  const current = `${LOG_BASE_NAME}${LOG_EXTENSION}`
  const last = keep - 1
  const renames: Array<[string, string]> = []
  for (let n = last - 1; n >= 1; n--) renames.push([rotated(n), rotated(n + 1)])
  renames.push([current, rotated(1)])
  return { remove: rotated(last), renames }
}

/** True for the names of the app's own log files (current and rotated). */
export function isLogFileName(name: string): boolean {
  return new RegExp(`^${LOG_BASE_NAME}(\\.\\d+)?${LOG_EXTENSION.replace('.', '\\.')}$`).test(name)
}

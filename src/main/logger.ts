import { app, type WebContents } from 'electron'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_LOG_LEVEL,
  formatLogLine,
  LOG_BASE_NAME,
  LOG_EXTENSION,
  LOG_KEEP_FILES,
  LOG_MAX_BYTES,
  levelAllows,
  maskSecrets,
  rotationSteps,
  type LogLevel
} from '../shared/logging'
import { chooseLogDir } from './log-dir'

/** The app's own log: one text file with rotation. Never throws, never blocks the app. */

let level: LogLevel = DEFAULT_LOG_LEVEL
let directory: string | null = null
let usingFallback = false
let currentSize = 0
let disabled = false

const CURRENT_FILE = `${LOG_BASE_NAME}${LOG_EXTENSION}`

/** Creates the folder if needed and checks that a file can be written there. */
function canWrite(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.write-test')
    writeFileSync(probe, '')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function currentFileSize(dir: string): number {
  try {
    return statSync(join(dir, CURRENT_FILE)).size
  } catch {
    return 0
  }
}

/** Picks the log folder and writes the first entries. Call once, as early as possible. */
export function initLogger(initialLevel: LogLevel): void {
  level = initialLevel
  const choice = chooseLogDir({
    packaged: app.isPackaged,
    portableDir: process.env['PORTABLE_EXECUTABLE_DIR'],
    execDir: dirname(process.execPath),
    projectDir: app.getAppPath(),
    userLogsDir: app.getPath('logs'),
    join,
    canWrite
  })
  directory = choice.dir
  usingFallback = choice.fallback
  // The fallback folder is expected to work; make sure it exists.
  if (usingFallback) canWrite(directory)
  currentSize = currentFileSize(directory)

  log.info('logger', `Logging to ${directory} (level ${level})`)
  if (usingFallback) {
    log.warn('logger', 'The preferred log folder next to the app is not writable; using the per-user folder instead.')
  }
}

export function setLogLevel(next: LogLevel): void {
  if (next === level) return
  const previous = level
  level = next
  log.info('logger', `Log level changed from ${previous} to ${next}`)
}

export function getLogLevel(): LogLevel {
  return level
}

/** The folder with the log files, or null before `initLogger`. */
export function getLogDirectory(): string | null {
  return directory
}

/** True when the preferred folder (next to the app) could not be used. */
export function isLogFallback(): boolean {
  return usingFallback
}

/** Makes room for a new current file: removes the oldest and shifts the rest up by one. */
function rotate(dir: string): void {
  const steps = rotationSteps(LOG_KEEP_FILES)
  try {
    rmSync(join(dir, steps.remove), { force: true })
    for (const [from, to] of steps.renames) {
      try {
        renameSync(join(dir, from), join(dir, to))
      } catch {
        // A missing file in the chain is normal while fewer than the maximum number exist.
      }
    }
  } catch {
    // Rotation is best effort.
  }
  currentSize = 0
}

function write(messageLevel: LogLevel, scope: string, message: string): void {
  if (disabled || directory === null || !levelAllows(level, messageLevel)) return

  const line = `${formatLogLine(new Date(), messageLevel, scope, message)}\n`
  if (!app.isPackaged) process.stdout.write(line)

  const bytes = Buffer.byteLength(line)
  try {
    if (currentSize + bytes > LOG_MAX_BYTES) rotate(directory)
    appendFileSync(join(directory, CURRENT_FILE), line)
    currentSize += bytes
  } catch (error) {
    // Never let logging break the app. Try the per-user folder once, then give up quietly.
    if (!usingFallback) {
      const fallback = app.getPath('logs')
      if (canWrite(fallback)) {
        directory = fallback
        usingFallback = true
        currentSize = currentFileSize(fallback)
        try {
          appendFileSync(join(fallback, CURRENT_FILE), line)
          currentSize += bytes
          return
        } catch {
          // fall through
        }
      }
    }
    disabled = true
    console.error('Logging was switched off because the log file cannot be written:', error)
  }
}

export const log = {
  error: (scope: string, message: string): void => write('error', scope, message),
  warn: (scope: string, message: string): void => write('warn', scope, message),
  info: (scope: string, message: string): void => write('info', scope, message),
  debug: (scope: string, message: string): void => write('debug', scope, message)
}

/**
 * The error to throw when an IPC call comes from a view that may not make it. It is also logged: such
 * a call means a page tried something it has no business doing.
 */
export function untrustedSender(): Error {
  log.warn('ipc', 'Rejected an IPC call from an untrusted sender.')
  return new Error('Untrusted IPC sender.')
}

/** Text for an unknown thrown value, with the stack for real errors. Secrets are masked. */
export function describeError(error: unknown): string {
  const text = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)
  return maskSecrets(text)
}

/**
 * Logs what matters about a page: crashes, failed loads and, for the app's own pages, warnings and
 * errors from the page's console. `ownPage` is false for the remote page, whose console is not the
 * app's business (it can be very noisy).
 */
export function logWebContents(contents: WebContents, scope: string, ownPage: boolean): void {
  contents.on('render-process-gone', (_event, details) => {
    log.error(scope, `The page's process ended unexpectedly (${details.reason}, exit code ${details.exitCode}).`)
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
    // -3 means a navigation was replaced by a newer one: not a failure.
    if (isMainFrame && errorCode !== -3) {
      log.warn(scope, `Failed to load ${url}: ${errorDescription} (${errorCode})`)
    }
  })
  if (ownPage) {
    contents.on('console-message', (event) => {
      if (event.level === 'error') log.error(scope, `console: ${event.message}`)
      else if (event.level === 'warning') log.warn(scope, `console: ${event.message}`)
    })
  }
}

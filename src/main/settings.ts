import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isLogLevel, type LogLevel } from '../shared/logging'
import {
  DEFAULT_LOG_LEVEL,
  DEFAULT_MASK_TOKENS,
  DEFAULT_SBX_PATH,
  DEFAULT_TOKEN_COMMAND,
  validateTokenCommand
} from '../shared/settings'

/** Everything persisted in settings.json. */
export interface Settings {
  /** Last address that connected successfully (without launch token). */
  lastUrl: string | null
  /** Name or path of the sbx CLI. */
  sbxPath: string
  /** Command run inside a sandbox to get the launch token. Empty: feature off. */
  tokenCommand: string
  /** How much the app writes to its own log file. */
  logLevel: LogLevel
  /** Mask launch tokens in sandbox logs shown by the log viewer. */
  maskTokens: boolean
}

const DEFAULTS: Settings = {
  lastUrl: null,
  sbxPath: DEFAULT_SBX_PATH,
  tokenCommand: DEFAULT_TOKEN_COMMAND,
  logLevel: DEFAULT_LOG_LEVEL,
  maskTokens: DEFAULT_MASK_TOKENS
}

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Reads settings from disk. A missing or malformed file, or a bad value, yields the default. */
function readFromDisk(): Settings {
  try {
    const raw: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    if (typeof raw === 'object' && raw !== null) {
      const record = raw as Record<string, unknown>
      const lastUrl = record['lastUrl']
      const sbxPath = record['sbxPath']
      const tokenCommand = record['tokenCommand']
      const logLevel = record['logLevel']
      const maskTokens = record['maskTokens']
      return {
        logLevel: isLogLevel(logLevel) ? logLevel : DEFAULTS.logLevel,
        maskTokens: typeof maskTokens === 'boolean' ? maskTokens : DEFAULTS.maskTokens,
        lastUrl: typeof lastUrl === 'string' ? lastUrl : DEFAULTS.lastUrl,
        sbxPath: typeof sbxPath === 'string' && sbxPath.trim() !== '' ? sbxPath : DEFAULTS.sbxPath,
        tokenCommand:
          typeof tokenCommand === 'string' && validateTokenCommand(tokenCommand) === null
            ? tokenCommand
            : DEFAULTS.tokenCommand
      }
    }
  } catch {
    // First start or unreadable file: fall through to the defaults.
  }
  return { ...DEFAULTS }
}

export function getSettings(): Settings {
  cache ??= readFromDisk()
  return cache
}

/** Merges a patch into the settings and persists the result. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  writeToDisk(next)
  cache = next
  return next
}

/**
 * Writes settings, preferably atomically (temp file + rename) so a crash cannot leave a
 * half-written file. Some file systems (redirected or virtualized profile folders) refuse the
 * rename; then the file is written in place instead.
 */
function writeToDisk(settings: Settings): void {
  const target = settingsPath()
  const content = `${JSON.stringify(settings, null, 2)}\n`
  mkdirSync(dirname(target), { recursive: true })

  const temp = `${target}.tmp`
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, target)
  } catch {
    writeFileSync(target, content, 'utf8')
    try {
      unlinkSync(temp)
    } catch {
      // The temp file may not exist; nothing to clean up.
    }
  }
}

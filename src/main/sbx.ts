import { execFile } from 'node:child_process'
import { maskSecrets } from '../shared/logging'
import { log } from './logger'
import { getSettings } from './settings'

export type SbxErrorKind = 'not-found' | 'timeout' | 'failed'

/** Failure of an sbx call with a message that is safe to show to the user. */
export class SbxError extends Error {
  constructor(
    message: string,
    readonly kind: SbxErrorKind
  ) {
    super(message)
    this.name = 'SbxError'
  }
}

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** First line of some output, with launch tokens masked so a credential never reaches an error message. */
function firstLine(text: string): string {
  return maskSecrets(text.trim().split(/\r?\n/, 1)[0] ?? '')
}

/**
 * Runs the sbx CLI with a fixed argument list and returns its stdout.
 *
 * No shell is involved (`execFile`), so arguments are never interpreted. Callers pass only
 * constant subcommands plus values that were validated (sandbox names, port numbers).
 * `--no-input` makes sbx fail instead of waiting for an answer nobody can give.
 */
export function runSbx(
  args: readonly string[],
  options: { timeoutMs?: number; executable?: string } = {}
): Promise<string> {
  return execSbx(args, options, 'utf8')
}

/**
 * Like `runSbx`, but returns stdout as raw bytes. Needed where text is cut at arbitrary byte
 * positions (the log viewer), so a multi-byte character is never decoded in pieces.
 */
export function runSbxBytes(
  args: readonly string[],
  options: { timeoutMs?: number; executable?: string } = {}
): Promise<Buffer> {
  return execSbx(args, options, 'buffer')
}

function execSbx<E extends 'utf8' | 'buffer'>(
  args: readonly string[],
  options: { timeoutMs?: number; executable?: string },
  encoding: E
): Promise<E extends 'buffer' ? Buffer : string> {
  const executable = options.executable ?? getSettings().sbxPath
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const summary = describeCall(args)
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['--no-input', ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES, encoding },
      (error, stdout, stderr) => {
        const took = Date.now() - startedAt
        if (!error) {
          // Only the call and its duration are logged, never its output: that can hold a launch token.
          log.debug('sbx', `${summary} -> ok in ${took} ms`)
          resolve(stdout as E extends 'buffer' ? Buffer : string)
          return
        }
        let failure: SbxError
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          failure = new SbxError(
            `The sbx executable "${executable}" was not found. Install Docker Sandboxes or set its path in Settings.`,
            'not-found'
          )
        } else if ('killed' in error && error.killed) {
          failure = new SbxError(`sbx did not answer within ${timeoutMs / 1000} seconds.`, 'timeout')
        } else {
          failure = new SbxError(
            firstLine(String(stderr)) || firstLine(String(stdout)) || error.message,
            'failed'
          )
        }
        log.warn('sbx', `${summary} -> ${failure.kind} after ${took} ms: ${failure.message}`)
        reject(failure)
      }
    )
  })
}

/** The call as one short line for the log: long arguments (scripts) are cut. */
function describeCall(args: readonly string[]): string {
  const MAX_ARGUMENT = 100
  return `sbx ${args.map((arg) => (arg.length > MAX_ARGUMENT ? `${arg.slice(0, MAX_ARGUMENT)}…` : arg)).join(' ')}`
}

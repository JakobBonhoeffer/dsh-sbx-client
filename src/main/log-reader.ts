import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LogChunk } from '../shared/logs'
import {
  LOG_FINDER_PRINTF,
  MAX_FOUND_LOGS,
  MAX_READ_BYTES,
  cleanLine,
  concatBytes,
  looksBinary,
  parseLogFinder,
  splitAtLastNewline,
  splitSizeHeader,
  tailLines,
  toLines,
  type FoundLog
} from '../shared/log-view'
import { isLogFileName, maskSecrets } from '../shared/logging'
import { runSbx, runSbxBytes, SbxError } from './sbx'

const READ_TIMEOUT_MS = 30_000
const FIND_TIMEOUT_MS = 30_000

/** An unfinished line longer than this is shown as a line of its own instead of waiting for its end. */
const MAX_CARRY_BYTES = 64 * 1024

/** Where a log is read from: a file inside a sandbox, or a file of this app's own log folder. */
export type LogTarget =
  | { kind: 'sandbox'; sandbox: string; path: string }
  | { kind: 'app'; directory: string; fileName: string }

/**
 * Where the viewer stands in one file: the byte offset up to which it has read and the bytes of the
 * unfinished last line (kept so that a line is shown whole, whenever its end arrives).
 */
export interface LogCursor {
  target: LogTarget
  lineCount: number
  offset: number
  carry: Uint8Array
}

/**
 * First load: prints the file size, then the last N lines of the file as it was at that size, at
 * most the read limit. `head -c "$size"` pins the content to the size that was printed, so the
 * offset for following is exact even if the file grows meanwhile. The path and numbers are
 * arguments of the script, never part of it.
 */
const OPEN_SCRIPT = [
  'f="$1"',
  'if [ ! -f "$f" ]; then echo "not a regular file" >&2; exit 3; fi',
  'if [ ! -r "$f" ]; then echo "permission denied" >&2; exit 4; fi',
  'size=$(wc -c < "$f")',
  'printf "%s\\n" "$size"',
  'head -c "$size" -- "$f" | tail -n "$2" | tail -c "$3"'
].join('\n')

/** Following: prints the new size, then the bytes between the offset and the size (at most the read limit). */
const POLL_SCRIPT = [
  'f="$1"',
  'if [ ! -f "$f" ]; then echo "not a regular file" >&2; exit 3; fi',
  'size=$(wc -c < "$f")',
  'printf "%s\\n" "$size"',
  'if [ "$size" -gt "$2" ]; then',
  '  n=$((size - $2))',
  '  if [ "$n" -gt "$3" ]; then n="$3"; fi',
  '  tail -c +$(($2 + 1)) -- "$f" | head -c "$n"',
  'fi'
].join('\n')

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function chunkOf(complete: Uint8Array, rest: Uint8Array, mask: boolean): LogChunk {
  const hide = (text: string): string => (mask ? maskSecrets(text) : text)
  return {
    lines: toLines(decode(complete)).map(hide),
    partial: hide(cleanLine(decode(rest)))
  }
}

function checkBody(body: Uint8Array): void {
  if (looksBinary(body)) throw new SbxError('This looks like a binary file, not a text log.', 'failed')
}

// --- Reading the raw bytes ---------------------------------------------------------------------

/** What a first load returns: the file size and the bytes of its last lines (whole lines, plus an unfinished one). */
async function fetchOpen(
  target: LogTarget,
  lineCount: number
): Promise<{ size: number; body: Uint8Array; cutStart: boolean }> {
  if (target.kind === 'app') return fetchOpenApp(target, lineCount)

  const output = await runSbxBytes(
    ['exec', target.sandbox, 'sh', '-c', OPEN_SCRIPT, 'sh', target.path, String(lineCount), String(MAX_READ_BYTES)],
    { timeoutMs: READ_TIMEOUT_MS }
  )
  const parsed = splitSizeHeader(output)
  if (parsed === null) throw new SbxError('The file could not be read.', 'failed')
  checkBody(parsed.body)

  // The byte limit cut the beginning of the data: drop the (probably partial) first line.
  const cutStart = parsed.body.length >= MAX_READ_BYTES
  let body = parsed.body
  if (cutStart) {
    const firstBreak = body.indexOf(0x0a)
    body = firstBreak === -1 ? body.subarray(0, 0) : body.subarray(firstBreak + 1)
  }
  return { size: parsed.size, body, cutStart }
}

/** The app's own log is a file on this computer: its name is checked, the folder is the log folder. */
function appFile(target: Extract<LogTarget, { kind: 'app' }>): string {
  if (!isLogFileName(target.fileName)) throw new SbxError('Not a log file of this app.', 'failed')
  return join(target.directory, target.fileName)
}

async function fetchOpenApp(
  target: Extract<LogTarget, { kind: 'app' }>,
  lineCount: number
): Promise<{ size: number; body: Uint8Array; cutStart: boolean }> {
  const handle = await open(appFile(target), 'r').catch(() => {
    throw new SbxError('The log file could not be opened.', 'failed')
  })
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - MAX_READ_BYTES)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    checkBody(buffer)

    let data: Uint8Array = buffer
    if (start > 0) {
      const firstBreak = data.indexOf(0x0a)
      data = firstBreak === -1 ? data.subarray(0, 0) : data.subarray(firstBreak + 1)
    }
    const { complete, rest } = splitAtLastNewline(data)
    const tail = tailLines(complete, lineCount)
    return { size, body: concatBytes(tail.bytes, rest), cutStart: start > 0 && !tail.cut }
  } finally {
    await handle.close()
  }
}

/** What a poll returns: the current size and the bytes between `offset` and it (at most the read limit). */
async function fetchPoll(target: LogTarget, offset: number): Promise<{ size: number; body: Uint8Array }> {
  if (target.kind === 'app') {
    const handle = await open(appFile(target), 'r').catch(() => {
      throw new SbxError('The log file could not be opened.', 'failed')
    })
    try {
      const { size } = await handle.stat()
      const length = size > offset ? Math.min(size - offset, MAX_READ_BYTES) : 0
      const buffer = Buffer.alloc(length)
      if (length > 0) await handle.read(buffer, 0, length, offset)
      checkBody(buffer)
      return { size, body: buffer }
    } finally {
      await handle.close()
    }
  }

  const output = await runSbxBytes(
    ['exec', target.sandbox, 'sh', '-c', POLL_SCRIPT, 'sh', target.path, String(offset), String(MAX_READ_BYTES)],
    { timeoutMs: READ_TIMEOUT_MS }
  )
  const parsed = splitSizeHeader(output)
  if (parsed === null) throw new SbxError('The file could not be read.', 'failed')
  checkBody(parsed.body)
  return parsed
}

// --- What the viewer uses ----------------------------------------------------------------------

/** Loads the end of a file and returns where following continues. */
export async function openLog(
  target: LogTarget,
  lineCount: number,
  mask: boolean
): Promise<{ cursor: LogCursor; size: number; cutStart: boolean } & LogChunk> {
  const { size, body, cutStart } = await fetchOpen(target, lineCount)
  const { complete, rest } = splitAtLastNewline(body)
  return {
    cursor: { target, lineCount, offset: size, carry: rest },
    size,
    cutStart,
    ...chunkOf(complete, rest, mask)
  }
}

/**
 * Reads what was added since the last read. When the file became smaller (it was rotated or
 * emptied) the caller loads it again from the end; `reset` says so.
 */
export async function pollLog(
  cursor: LogCursor,
  mask: boolean
): Promise<{ reset: true } | ({ reset: false; size: number } & LogChunk)> {
  const { size, body } = await fetchPoll(cursor.target, cursor.offset)
  if (size < cursor.offset) return { reset: true }

  const data = concatBytes(cursor.carry, body)
  let { complete, rest } = splitAtLastNewline(data)
  // A very long line without a break is shown as it is rather than held back forever.
  if (rest.length > MAX_CARRY_BYTES) {
    complete = data
    rest = data.subarray(0, 0)
  }
  cursor.offset += body.length
  cursor.carry = rest
  return { reset: false, size, ...chunkOf(complete, rest, mask) }
}

/**
 * Finds `*.log` files below the given folders (a few levels deep, newest first). Folders that do
 * not exist are ignored. The folders are arguments of the script, never part of it.
 */
export async function findLogs(sandbox: string, roots: readonly string[]): Promise<FoundLog[]> {
  const script =
    `find -H "$@" -maxdepth 5 \\( -name node_modules -o -name .git \\) -prune -o ` +
    `-type f -name '*.log' -printf '${LOG_FINDER_PRINTF}' 2>/dev/null; exit 0`
  const output = await runSbx(['exec', sandbox, 'sh', '-c', script, 'sh', ...roots], { timeoutMs: FIND_TIMEOUT_MS })
  return parseLogFinder(output, MAX_FOUND_LOGS)
}

/** The app's own log files (current and rotated) in its log folder, newest first. Paths are the plain file names. */
export async function findAppLogs(directory: string): Promise<FoundLog[]> {
  const found: FoundLog[] = []
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    if (!isLogFileName(name)) continue
    const info = await stat(join(directory, name)).catch(() => null)
    if (info?.isFile()) found.push({ path: name, size: info.size, modified: Math.round(info.mtimeMs) })
  }
  return found.sort((a, b) => b.modified - a.modified)
}

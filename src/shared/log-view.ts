/**
 * Pure helpers of the log viewer: limits, cleaning of log text, splitting of what `sbx exec`
 * returns and parsing of the list of log files found in a sandbox. No Electron or Node imports on
 * purpose, so everything here can be exercised on its own.
 */

/** How many of the last lines the viewer loads. */
export const LOG_LINE_OPTIONS = [200, 500, 1000, 5000] as const
export const DEFAULT_LOG_LINES = 500

export function isValidLineCount(value: unknown): value is number {
  return typeof value === 'number' && (LOG_LINE_OPTIONS as readonly number[]).includes(value)
}

/** The most bytes one read returns (the first load and each follow step). */
export const MAX_READ_BYTES = 1024 * 1024

/** Longer lines are cut, so one huge line cannot freeze the view. */
export const MAX_LINE_LENGTH = 4000

/** The view keeps at most this many lines; older ones drop out while following. */
export const MAX_VIEW_LINES = 20000

/** How many log files the finder returns. */
export const MAX_FOUND_LOGS = 200

/** A log file found in a sandbox. */
export interface FoundLog {
  path: string
  size: number
  /** Last modification, milliseconds since the epoch. */
  modified: number
}

/** ANSI escape sequences: CSI (colors, cursor), OSC (titles, hyperlinks) and lone ESC + letter. */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/**
 * Makes one raw log line fit for display: escape sequences are removed, a carriage return keeps
 * only what follows it (progress bars redraw their line), other control characters except the tab
 * disappear and very long lines are cut.
 */
export function cleanLine(raw: string): string {
  // "text\r" (a Windows line ending) keeps the text; "a\rb" keeps what was redrawn last.
  let line = stripAnsi(raw)
    .split('\r')
    .filter((piece) => piece !== '')
    .pop() ?? ''
  // eslint-disable-next-line no-control-regex
  line = line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line
}

/** True when the bytes contain a NUL, which text logs never do. */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0)
}

const NEWLINE = 0x0a

/** Splits bytes after the last line break: `complete` ends with it (or is empty), `rest` is an unfinished line. */
export function splitAtLastNewline(bytes: Uint8Array): { complete: Uint8Array; rest: Uint8Array } {
  const index = bytes.lastIndexOf(NEWLINE)
  if (index === -1) return { complete: bytes.subarray(0, 0), rest: bytes }
  return { complete: bytes.subarray(0, index + 1), rest: bytes.subarray(index + 1) }
}

/**
 * The last `count` lines of bytes that end with a line break (or are empty): returns the part from
 * the start of the first of those lines, and whether earlier lines were left out.
 */
export function tailLines(complete: Uint8Array, count: number): { bytes: Uint8Array; cut: boolean } {
  // The final line break ends the last line; look for the break before the first wanted line.
  let breaks = 0
  for (let i = complete.length - 2; i >= 0; i--) {
    if (complete[i] === NEWLINE) {
      breaks++
      if (breaks === count) return { bytes: complete.subarray(i + 1), cut: true }
    }
  }
  return { bytes: complete, cut: false }
}

/** Joins two byte arrays. */
export function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length)
  joined.set(first, 0)
  joined.set(second, first.length)
  return joined
}

/**
 * The scripts run in the sandbox print the file size and a line break first and the content after
 * it. Returns both, or null when the output does not start like that.
 */
export function splitSizeHeader(output: Uint8Array): { size: number; body: Uint8Array } | null {
  const end = output.indexOf(NEWLINE)
  if (end < 1 || end > 20) return null
  let text = ''
  for (let i = 0; i < end; i++) text += String.fromCharCode(output[i] ?? 0)
  if (!/^\s*\d+\s*$/.test(text)) return null
  const size = Number(text.trim())
  return Number.isSafeInteger(size) ? { size, body: output.subarray(end + 1) } : null
}

/**
 * Turns text that ends with a line break (or is empty) into lines, cleaned for display. A final
 * empty piece after the last line break is not a line.
 */
export function toLines(text: string): string[] {
  if (text === '') return []
  const pieces = text.split('\n')
  if (pieces[pieces.length - 1] === '') pieces.pop()
  return pieces.map(cleanLine)
}

/**
 * Parses the output of the finder: records separated by NUL, each `<seconds>\t<bytes>\t<path>`.
 * Broken records are skipped; the newest files come first.
 */
export function parseLogFinder(output: string, limit: number): FoundLog[] {
  const found: FoundLog[] = []
  for (const record of output.split('\0')) {
    const first = record.indexOf('\t')
    const second = first === -1 ? -1 : record.indexOf('\t', first + 1)
    if (second === -1) continue
    const seconds = Number(record.slice(0, first))
    const size = Number(record.slice(first + 1, second))
    const path = record.slice(second + 1)
    if (!Number.isFinite(seconds) || !Number.isFinite(size) || !path.startsWith('/')) continue
    found.push({ path, size, modified: Math.round(seconds * 1000) })
  }
  found.sort((a, b) => b.modified - a.modified)
  return found.slice(0, limit)
}

/** The command the finder runs; roots arrive as arguments. Exported so tests can see the record format. */
export const LOG_FINDER_PRINTF = '%T@\\t%s\\t%p\\0'

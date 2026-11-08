/** Contract between the main process and the Logs (log viewer) dialog. */

import type { ListResult } from './explorer'
import type { FoundLog } from './log-view'
import type { TransferResult } from './transfer'

/** Where a log is read from: a file in the sandbox, or the app's own log folder on this computer. */
export type LogSource = 'sandbox' | 'app'

export interface LogsContext {
  /** Sandbox the dialog was opened for. Null when it was opened for the app's own log only. */
  sandbox: string | null
  /** Which source the dialog starts with. */
  initialSource: LogSource
  /** Home directory of the sandbox user. Null if unknown. */
  home: string | null
  /** Folders of this computer mounted into the sandbox, for the quick access of the "Browse…" picker. */
  mounts: Array<{ sandboxPath: string; readOnly: boolean }>
  /** True when `token=…` is hidden in what the viewer shows (Settings, Logging). */
  maskTokens: boolean
  /** A log file to open at once (when the dialog was opened from the Files dialog). */
  initialPath: string | null
}

/** What a read of the log returns: new complete lines and the unfinished last line, if any. */
export interface LogChunk {
  lines: string[]
  /** The last line while it is still being written (no line break yet). Replaces the previous one. */
  partial: string
}

export type LogOpenResult =
  | ({
      ok: true
      /** The file that was opened, with `~` expanded. */
      path: string
      /** File size in bytes at the time of reading. */
      size: number
      /** True when only the end of the file was loaded because it is larger than the read limit. */
      cutStart: boolean
    } & LogChunk)
  | { ok: false; message: string }

export type LogPollResult =
  | ({
      ok: true
      /** True when the file became smaller (rotated or emptied): `lines` then replace the whole view. */
      reset: boolean
      size: number
    } & LogChunk)
  | { ok: false; message: string }

export type LogFindResult = { ok: true; files: FoundLog[] } | { ok: false; message: string }

export interface LogsApi {
  context: () => Promise<LogsContext | null>
  /**
   * Sandbox: looks for `*.log` files in the home folder, the shared folders, /var/log and /tmp.
   * App: lists the app's own log files (paths are plain file names).
   */
  find: (source: LogSource) => Promise<LogFindResult>
  /**
   * Loads the last `lines` lines of a file and remembers where the end is (for `poll`). For the
   * app source `path` is the name of one of the app's log files.
   */
  open: (source: LogSource, path: string, lines: number) => Promise<LogOpenResult>
  /** Reads what was added to the open file since the last `open` or `poll`. */
  poll: () => Promise<LogPollResult>
  /** Lists one folder for the "Browse…" picker. Read-only. */
  list: (path: string) => Promise<ListResult>
  /** Saves `text` (the current view) to a file that the user picks on this computer. */
  save: (text: string, suggestedName: string) => Promise<TransferResult>
  /** Back to the Sandboxes dialog. */
  back: () => Promise<void>
  /** Closes this dialog. */
  close: () => Promise<void>
}

export const LOGS_IPC = {
  context: 'logs:context',
  find: 'logs:find',
  open: 'logs:open',
  poll: 'logs:poll',
  list: 'logs:list',
  save: 'logs:save',
  back: 'logs:back'
} as const

/** How often the viewer asks for new lines while following. */
export const LOG_POLL_INTERVAL_MS = 2000

/** The most text "Save to host…" accepts from the page. */
export const MAX_SAVE_CHARS = 32 * 1024 * 1024

/** Contract between the main process and the Files (file browser) dialog. */

import type { TransferResult } from './transfer'

/** One entry of a directory inside a sandbox. */
export interface FileEntry {
  name: string
  /** True for directories and for symbolic links that point to a directory. */
  isDirectory: boolean
  isSymlink: boolean
  /** Size in bytes (meaningless for directories). */
  size: number
  /** Last modification, milliseconds since the epoch. */
  modified: number
}

export type ListResult =
  | {
      ok: true
      /** The directory that was listed, with `~` expanded. */
      path: string
      entries: FileEntry[]
      /** True when the directory has more entries than are returned. */
      truncated: boolean
    }
  | { ok: false; message: string }

/** Entries per directory the browser shows; larger directories are cut with a notice. */
export const MAX_LISTED_ENTRIES = 2000

export interface ExplorerContext {
  sandbox: string
  /** Home directory of the sandbox user. Null if unknown. */
  home: string | null
  /** Folders of this computer that are mounted into the sandbox, as seen from inside it. */
  mounts: Array<{ sandboxPath: string; readOnly: boolean }>
}

export interface ExplorerApi {
  context: () => Promise<ExplorerContext | null>
  /** Lists one directory. `path` is absolute or starts with `~`. */
  list: (path: string) => Promise<ListResult>
  /** Copies files or folders from the sandbox to a folder on this computer that the user picks. */
  copyToHost: (paths: string[]) => Promise<TransferResult>
  /** Asks for files or a folder on this computer and copies them into `destination` in the sandbox. */
  uploadHere: (destination: string, kind: 'files' | 'folder') => Promise<TransferResult>
  /** Creates a folder `name` inside the folder `parent`. */
  createFolder: (parent: string, name: string) => Promise<TransferResult>
  /** Renames the item at `path` (the new name stays in the same folder). */
  rename: (path: string, newName: string) => Promise<TransferResult>
  /** Deletes items after a confirmation in a native dialog. Not undoable. */
  remove: (paths: string[]) => Promise<TransferResult>
  /** Opens a file in the Logs dialog (replaces this dialog). */
  viewAsLog: (path: string) => Promise<TransferResult>
  /** Back to the Sandboxes dialog. */
  back: () => Promise<void>
  /** Closes this dialog. */
  close: () => Promise<void>
}

export const EXPLORER_IPC = {
  context: 'explorer:context',
  list: 'explorer:list',
  copyToHost: 'explorer:copy-to-host',
  uploadHere: 'explorer:upload-here',
  createFolder: 'explorer:create-folder',
  rename: 'explorer:rename',
  remove: 'explorer:remove',
  viewAsLog: 'explorer:view-as-log',
  back: 'explorer:back'
} as const

/** Contract between the main process and the "Copy files" dialog. */

import type { ListResult } from './explorer'

export interface TransferContext {
  /** Sandbox this dialog was opened for. */
  sandbox: string
  /** Home directory of the sandbox user, used as the suggested destination. Null if unknown. */
  home: string | null
  /** Folders of this computer mounted into the sandbox, for the quick access of the "Browse…" picker. */
  mounts: Array<{ sandboxPath: string; readOnly: boolean }>
}

export type TransferResult =
  | { status: 'done'; message: string }
  /** The user closed a file picker or answered "Cancel" to a confirmation. */
  | { status: 'cancelled'; message: string }
  | { status: 'error'; message: string }

export interface TransferApi {
  context: () => Promise<TransferContext | null>
  /** Asks for files on this computer and copies them into `destination` (a folder in the sandbox). */
  uploadFiles: (destination: string) => Promise<TransferResult>
  /** Asks for a folder on this computer and copies it into `destination` (a folder in the sandbox). */
  uploadFolder: (destination: string) => Promise<TransferResult>
  /** Copies a file or folder from the sandbox to a folder on this computer that the user picks. */
  download: (source: string) => Promise<TransferResult>
  /** Lists one folder of the sandbox for the "Browse…" picker. Read-only. */
  list: (path: string) => Promise<ListResult>
  /** Back to the Sandboxes dialog. */
  back: () => Promise<void>
  /** Closes this dialog. */
  close: () => Promise<void>
}

export const TRANSFER_IPC = {
  context: 'transfer:context',
  uploadFiles: 'transfer:upload-files',
  uploadFolder: 'transfer:upload-folder',
  download: 'transfer:download',
  list: 'transfer:list',
  back: 'transfer:back'
} as const

/**
 * Returns an error message, or null when the value is acceptable as a path inside a sandbox.
 * Paths must be absolute or start with `~` (the sandbox user's home) so they cannot be mistaken
 * for anything else.
 */
export function validateSandboxPath(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'Enter a path in the sandbox.'
  if (trimmed.length > 4096) return 'The path is too long.'
  if (/[\u0000-\u001f]/.test(trimmed)) return 'The path contains invalid characters.'
  if (!trimmed.startsWith('/') && trimmed !== '~' && !trimmed.startsWith('~/')) {
    return 'The path must start with / or ~/ .'
  }
  return null
}

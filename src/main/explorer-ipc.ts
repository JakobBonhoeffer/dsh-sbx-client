import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EXPLORER_IPC, type ExplorerContext, type ListResult } from '../shared/explorer'
import { isValidSandboxName, SANDBOX_IPC, type ActionResult } from '../shared/sandbox'
import { validateSandboxPath, type TransferResult } from '../shared/transfer'
import { baseName, joinSandboxPath, parentSandboxPath, resolveSandboxPath } from '../shared/sandbox-path'
import { containingMount, protectedReason, validateEntryName } from '../shared/protect'
import { confirmDelete, confirmReplace } from './confirm'
import type { DialogHost } from './dialogs'
import { listDirectory, makeDirectory, removeEntries, renameEntry } from './files'
import type { LogsOpener } from './logs-ipc'
import { listSandboxes } from './sandboxes'
import { SbxError } from './sbx'
import { copyFromSandbox, getSandboxHome, requireRunningSandbox } from './transfer'
import { runUpload } from './upload'
import { log, untrustedSender } from './logger'
import type { AppWindow } from './window'

function messageOf(error: unknown): string {
  return error instanceof SbxError || error instanceof Error ? error.message : String(error)
}

/** Browsing re-checks that the sandbox is running at most this often (a check costs a call to sbx). */
const RUNNING_CHECK_TTL_MS = 10_000

/** Upper bound for one "Copy to host" so a confused page cannot queue thousands of copies. */
const MAX_COPY_ITEMS = 200

/**
 * IPC for the Files (file browser) dialog. Everything the dialog asks for is checked here again:
 * the sandbox must be the one the dialog was opened for, paths must be absolute (or start with
 * `~`), and the target folder on this computer is chosen in a native picker opened by this
 * process, never taken from the page.
 */
export function registerExplorerIpc(app: AppWindow, dialogs: DialogHost, logs: LogsOpener): void {
  /** Sandbox the Files dialog was opened for. */
  let sandbox: string | null = null
  let home: string | null = null
  let runningCheckedAt = 0

  const assertFromExplorer = (event: IpcMainInvokeEvent): string => {
    if (!dialogs.isTrusted('explorer', event) || sandbox === null) {
      throw untrustedSender()
    }
    return sandbox
  }

  const ensureRunning = async (name: string, fresh = false): Promise<void> => {
    if (!fresh && Date.now() - runningCheckedAt < RUNNING_CHECK_TTL_MS) return
    await requireRunningSandbox(name)
    runningCheckedAt = Date.now()
  }

  /** Validates a path from the page and turns `~` into the sandbox user's home folder. */
  const resolvePath = async (name: string, input: unknown): Promise<string> => {
    if (typeof input !== 'string') throw new SbxError('Invalid path.', 'failed')
    const problem = validateSandboxPath(input)
    if (problem !== null) throw new SbxError(problem, 'failed')
    if (input.trim().startsWith('~') && home === null) home = await getSandboxHome(name)
    const resolved = resolveSandboxPath(input, home)
    if (resolved === null) throw new SbxError('Could not determine the home folder of the sandbox.', 'failed')
    return resolved
  }

  /**
   * What the safety rules need: the home folder and where shared folders are mounted, fetched fresh
   * for every change. Also returns the host path of each mount for the delete confirmation.
   */
  const protectionFor = async (
    name: string
  ): Promise<{ home: string | null; mounts: string[]; hostPathOf: Map<string, string> }> => {
    if (home === null) home = await getSandboxHome(name).catch(() => null)
    const info = (await listSandboxes()).find((item) => item.name === name)
    const mounts = info?.mounts ?? []
    return {
      home,
      mounts: mounts.map((mount) => mount.sandboxPath),
      hostPathOf: new Map(mounts.map((mount) => [mount.sandboxPath, mount.hostPath]))
    }
  }

  // From the Sandboxes dialog: open the Files dialog for one running sandbox.
  ipcMain.handle(SANDBOX_IPC.openExplorer, async (event, name: unknown): Promise<ActionResult> => {
    if (!dialogs.isTrusted('sandboxes', event)) throw untrustedSender()
    if (typeof name !== 'string' || !isValidSandboxName(name)) {
      return { ok: false, message: 'Invalid sandbox name.' }
    }
    try {
      await ensureRunning(name, true)
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
    sandbox = name
    home = null
    dialogs.open('explorer')
    return { ok: true }
  })

  ipcMain.handle(EXPLORER_IPC.context, async (event): Promise<ExplorerContext | null> => {
    const name = assertFromExplorer(event)
    home = await getSandboxHome(name).catch(() => null)
    const info = (await listSandboxes().catch(() => [])).find((item) => item.name === name)
    return {
      sandbox: name,
      home,
      mounts: (info?.mounts ?? []).map((mount) => ({ sandboxPath: mount.sandboxPath, readOnly: mount.readOnly }))
    }
  })

  ipcMain.handle(EXPLORER_IPC.list, async (event, input: unknown): Promise<ListResult> => {
    const name = assertFromExplorer(event)
    try {
      await ensureRunning(name)
      const path = await resolvePath(name, input)
      const { entries, truncated } = await listDirectory(name, path)
      return { ok: true, path, entries, truncated }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  // Opens one file in the Logs dialog. The viewer re-checks everything when it reads the file.
  ipcMain.handle(EXPLORER_IPC.viewAsLog, async (event, input: unknown): Promise<TransferResult> => {
    const name = assertFromExplorer(event)
    try {
      await ensureRunning(name, true)
      const path = await resolvePath(name, input)
      if (baseName(path) === '') return { status: 'error', message: 'Select a file.' }
      logs.openFor(name, path)
      return { status: 'done', message: 'Opening the log viewer.' }
    } catch (error) {
      return { status: 'error', message: messageOf(error) }
    }
  })

  ipcMain.handle(EXPLORER_IPC.back, (event) => {
    assertFromExplorer(event)
    dialogs.open('sandboxes')
  })

  ipcMain.handle(EXPLORER_IPC.copyToHost, async (event, input: unknown): Promise<TransferResult> => {
    const name = assertFromExplorer(event)
    try {
      if (!Array.isArray(input) || input.length === 0 || input.length > MAX_COPY_ITEMS) {
        return { status: 'error', message: 'Select one or more items first.' }
      }
      await ensureRunning(name, true)

      const sources: string[] = []
      for (const item of input) {
        const path = await resolvePath(name, item)
        // The file system root has no name to copy under; it would also be the whole sandbox.
        if (baseName(path) === '') {
          return { status: 'error', message: 'Select files or folders, not the file system root.' }
        }
        sources.push(path)
      }

      const picked = await dialog.showOpenDialog(app.window, {
        title: 'Choose where to copy the selection on this computer',
        properties: ['openDirectory', 'createDirectory']
      })
      const hostDir = picked.filePaths[0]
      if (picked.canceled || hostDir === undefined) return { status: 'cancelled', message: 'Cancelled.' }

      // Items land in the chosen folder under their own name; ask before replacing any.
      const existing = sources.map((path) => join(hostDir, baseName(path))).filter((path) => existsSync(path))
      if (existing.length > 0 && !(await confirmReplace(app.window, hostDir, existing))) {
        return { status: 'cancelled', message: 'Cancelled.' }
      }

      let copied = 0
      for (const source of sources) {
        try {
          await copyFromSandbox(name, source, hostDir)
          copied++
        } catch (error) {
          const done = copied > 0 ? ` (${copied} of ${sources.length} copied before)` : ''
          return { status: 'error', message: `Could not copy "${baseName(source)}"${done}: ${messageOf(error)}` }
        }
      }
      const what = sources.length === 1 ? `"${baseName(sources[0] ?? '')}"` : `${sources.length} items`
      log.info('files', `Copied ${sources.length} item(s) from ${name} to ${hostDir}: ${sources.slice(0, 20).join(', ')}`)
      return { status: 'done', message: `Copied ${what} to ${hostDir}` }
    } catch (error) {
      return { status: 'error', message: messageOf(error) }
    }
  })

  // --- Changing things ----------------------------------------------------------------------
  // Every change re-checks that the sandbox runs (fresh, not cached) and validates its inputs
  // again, whatever the page sent.

  ipcMain.handle(EXPLORER_IPC.uploadHere, async (event, destinationInput: unknown, kind: unknown) => {
    const name = assertFromExplorer(event)
    try {
      if (kind !== 'files' && kind !== 'folder') return { status: 'error', message: 'Invalid request.' } as const
      await ensureRunning(name, true)
      const destination = await resolvePath(name, destinationInput)
      return await runUpload(app.window, name, destination, kind)
    } catch (error) {
      return { status: 'error', message: messageOf(error) } as const
    }
  })

  ipcMain.handle(EXPLORER_IPC.createFolder, async (event, parentInput: unknown, nameInput: unknown) => {
    const name = assertFromExplorer(event)
    try {
      if (typeof nameInput !== 'string') return { status: 'error', message: 'Invalid name.' } as const
      const nameProblem = validateEntryName(nameInput)
      if (nameProblem !== null) return { status: 'error', message: nameProblem } as const

      await ensureRunning(name, true)
      const parent = await resolvePath(name, parentInput)
      await makeDirectory(name, joinSandboxPath(parent, nameInput))
      log.info('files', `Created the folder ${joinSandboxPath(parent, nameInput)} in ${name}`)
      return { status: 'done', message: `Created the folder "${nameInput}".` } as const
    } catch (error) {
      return { status: 'error', message: messageOf(error) } as const
    }
  })

  ipcMain.handle(EXPLORER_IPC.rename, async (event, pathInput: unknown, nameInput: unknown) => {
    const name = assertFromExplorer(event)
    try {
      if (typeof nameInput !== 'string') return { status: 'error', message: 'Invalid name.' } as const
      const nameProblem = validateEntryName(nameInput)
      if (nameProblem !== null) return { status: 'error', message: nameProblem } as const

      await ensureRunning(name, true)
      const path = await resolvePath(name, pathInput)
      const protection = await protectionFor(name)
      const reason = protectedReason(path, protection)
      if (reason !== null) {
        log.warn('files', `Refused to rename ${path} in ${name}: ${reason}`)
        return { status: 'error', message: `"${baseName(path) || '/'}" cannot be renamed: ${reason}.` } as const
      }

      if (nameInput === baseName(path)) return { status: 'done', message: 'The name did not change.' } as const
      await renameEntry(name, path, joinSandboxPath(parentSandboxPath(path), nameInput))
      log.info('files', `Renamed ${path} to ${nameInput} in ${name}`)
      return { status: 'done', message: `Renamed "${baseName(path)}" to "${nameInput}".` } as const
    } catch (error) {
      return { status: 'error', message: messageOf(error) } as const
    }
  })

  ipcMain.handle(EXPLORER_IPC.remove, async (event, input: unknown) => {
    const name = assertFromExplorer(event)
    try {
      if (!Array.isArray(input) || input.length === 0 || input.length > MAX_COPY_ITEMS) {
        return { status: 'error', message: 'Select one or more items first.' } as const
      }
      await ensureRunning(name, true)
      const protection = await protectionFor(name)

      const paths: string[] = []
      for (const item of input) {
        const path = await resolvePath(name, item)
        const reason = protectedReason(path, protection)
        if (reason !== null) {
          log.warn('files', `Refused to delete ${path} in ${name}: ${reason}`)
          return { status: 'error', message: `"${baseName(path) || '/'}" cannot be deleted: ${reason}.` } as const
        }
        paths.push(path)
      }

      // Items inside a folder shared with this computer also disappear from this computer.
      const shared: string[] = []
      for (const path of paths) {
        const mount = containingMount(path, protection.mounts)
        if (mount !== null) shared.push(protection.hostPathOf.get(mount) ?? mount)
      }

      if (!(await confirmDelete(app.window, name, paths, shared))) {
        log.info('files', `Delete of ${paths.length} item(s) in ${name} was cancelled by the user.`)
        return { status: 'cancelled', message: 'Cancelled.' } as const
      }

      await removeEntries(name, paths)
      const what = paths.length === 1 ? `"${baseName(paths[0] ?? '')}"` : `${paths.length} items`
      log.info('files', `Deleted ${paths.length} item(s) from ${name}: ${paths.slice(0, 20).join(', ')}`)
      return { status: 'done', message: `Deleted ${what}.` } as const
    } catch (error) {
      return { status: 'error', message: messageOf(error) } as const
    }
  })
}

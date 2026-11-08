import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  isValidSandboxName,
  SANDBOX_IPC,
  type ActionResult
} from '../shared/sandbox'
import {
  TRANSFER_IPC,
  validateSandboxPath,
  type TransferContext,
  type TransferResult
} from '../shared/transfer'
import type { ListResult } from '../shared/explorer'
import { confirmReplace as confirmReplaceIn } from './confirm'
import type { DialogHost } from './dialogs'
import { listDirectory } from './files'
import { listSandboxes } from './sandboxes'
import { runUpload } from './upload'
import { baseName, resolveSandboxPath } from '../shared/sandbox-path'
import { SbxError } from './sbx'
import { copyFromSandbox, getSandboxHome, requireRunningSandbox } from './transfer'
import { log, untrustedSender } from './logger'
import type { AppWindow } from './window'

function messageOf(error: unknown): string {
  return error instanceof SbxError || error instanceof Error ? error.message : String(error)
}

const cancelled = (): TransferResult => ({ status: 'cancelled', message: 'Cancelled.' })
const failed = (error: unknown): TransferResult => ({ status: 'error', message: messageOf(error) })

/**
 * IPC for the "Copy files" dialog. The dialog never supplies a path on this computer: the files
 * or folders are chosen in native pickers opened here, and an existing target is only replaced
 * after the user confirmed it, because `sbx cp` overwrites without asking.
 */
export function registerTransferIpc(app: AppWindow, dialogs: DialogHost): void {
  /** Sandbox the open (or last opened) Copy files dialog belongs to. */
  let sandbox: string | null = null

  const assertFromTransfer = (event: IpcMainInvokeEvent): string => {
    if (!dialogs.isTrusted('transfer', event) || sandbox === null) {
      throw untrustedSender()
    }
    return sandbox
  }

  const confirmReplace = (where: string, existing: readonly string[]): Promise<boolean> =>
    confirmReplaceIn(app.window, where, existing)

  // From the Sandboxes dialog: open the Copy files dialog for one sandbox.
  ipcMain.handle(SANDBOX_IPC.openTransfer, async (event, name: unknown): Promise<ActionResult> => {
    if (!dialogs.isTrusted('sandboxes', event)) throw untrustedSender()
    if (typeof name !== 'string' || !isValidSandboxName(name)) {
      return { ok: false, message: 'Invalid sandbox name.' }
    }
    try {
      await requireRunningSandbox(name)
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
    sandbox = name
    dialogs.open('transfer')
    return { ok: true }
  })

  ipcMain.handle(TRANSFER_IPC.context, async (event): Promise<TransferContext | null> => {
    const name = assertFromTransfer(event)
    const home = await getSandboxHome(name).catch(() => null)
    const info = (await listSandboxes().catch(() => [])).find((item) => item.name === name)
    return {
      sandbox: name,
      home,
      mounts: (info?.mounts ?? []).map((mount) => ({ sandboxPath: mount.sandboxPath, readOnly: mount.readOnly }))
    }
  })

  // Listing for the "Browse…" picker: read-only, same command and limits as the file browser.
  ipcMain.handle(TRANSFER_IPC.list, async (event, input: unknown): Promise<ListResult> => {
    const name = assertFromTransfer(event)
    try {
      await requireRunningSandbox(name)
      const path = await resolveSandboxInput(name, input)
      const { entries, truncated } = await listDirectory(name, path)
      return { ok: true, path, entries, truncated }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(TRANSFER_IPC.back, (event) => {
    assertFromTransfer(event)
    dialogs.open('sandboxes')
  })

  /** Validates a path typed by the user (destination folder or download source) and expands ~. */
  const resolveSandboxInput = async (name: string, input: unknown): Promise<string> => {
    if (typeof input !== 'string') throw new SbxError('Invalid destination.', 'failed')
    const problem = validateSandboxPath(input)
    if (problem !== null) throw new SbxError(problem, 'failed')
    const home = input.trim().startsWith('~') ? await getSandboxHome(name) : null
    const resolved = resolveSandboxPath(input, home)
    if (resolved === null) throw new SbxError('Could not determine the home folder of the sandbox.', 'failed')
    return resolved
  }

  const upload = async (
    event: IpcMainInvokeEvent,
    destinationInput: unknown,
    kind: 'files' | 'folder'
  ): Promise<TransferResult> => {
    const name = assertFromTransfer(event)
    try {
      await requireRunningSandbox(name)
      const destination = await resolveSandboxInput(name, destinationInput)
      return await runUpload(app.window, name, destination, kind)
    } catch (error) {
      return failed(error)
    }
  }

  ipcMain.handle(TRANSFER_IPC.uploadFiles, (event, destination: unknown) => upload(event, destination, 'files'))
  ipcMain.handle(TRANSFER_IPC.uploadFolder, (event, destination: unknown) => upload(event, destination, 'folder'))

  ipcMain.handle(TRANSFER_IPC.download, async (event, sourceInput: unknown): Promise<TransferResult> => {
    const name = assertFromTransfer(event)
    try {
      await requireRunningSandbox(name)
      const source = await resolveSandboxInput(name, sourceInput)

      const picked = await dialog.showOpenDialog(app.window, {
        title: 'Choose where to save the download',
        properties: ['openDirectory', 'createDirectory']
      })
      const hostDir = picked.filePaths[0]
      if (picked.canceled || hostDir === undefined) return cancelled()

      // The copy lands in the chosen folder under its own name; warn before replacing one.
      const target = join(hostDir, baseName(source))
      if (existsSync(target) && !(await confirmReplace(hostDir, [target]))) return cancelled()

      await copyFromSandbox(name, source, hostDir)
      log.info('files', `Downloaded ${name}:${source} to ${hostDir}`)
      return { status: 'done', message: `Copied ${name}:${source} to ${hostDir}` }
    } catch (error) {
      return failed(error)
    }
  })
}

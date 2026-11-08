import { dialog, type BaseWindow } from 'electron'
import { baseName, joinSandboxPath } from '../shared/sandbox-path'
import type { TransferResult } from '../shared/transfer'
import { confirmReplace } from './confirm'
import { log } from './logger'
import { SbxError } from './sbx'
import { copyToSandbox, findExistingInSandbox, giveToSandboxUser } from './transfer'

function messageOf(error: unknown): string {
  return error instanceof SbxError || error instanceof Error ? error.message : String(error)
}

/**
 * Lets the user pick files (or one folder) on this computer in a native picker and copies them
 * into `destination`, a folder of the sandbox. The caller has already checked that the sandbox
 * runs and has resolved `destination` to an absolute path. Shared by the Copy files dialog and
 * the file browser, so both behave the same way:
 *  - an existing item with the same name is only replaced after a confirmation (`sbx cp` would
 *    replace it silently), and
 *  - everything copied is handed to the regular sandbox user (`sbx cp` creates it as root).
 */
export async function runUpload(
  parent: BaseWindow,
  sandbox: string,
  destination: string,
  kind: 'files' | 'folder'
): Promise<TransferResult> {
  const picked = await dialog.showOpenDialog(parent, {
    title: kind === 'files' ? 'Choose files to upload' : 'Choose a folder to upload',
    properties: kind === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { status: 'cancelled', message: 'Cancelled.' }
  const hostPaths = picked.filePaths

  const targets = hostPaths.map((path) => joinSandboxPath(destination, baseName(path)))
  const existing = await findExistingInSandbox(sandbox, targets)
  if (existing.length > 0 && !(await confirmReplace(parent, `${sandbox}:${destination}`, existing))) {
    return { status: 'cancelled', message: 'Cancelled.' }
  }

  let copied = 0
  let ownershipFixed = true
  for (const hostPath of hostPaths) {
    try {
      await copyToSandbox(sandbox, hostPath, destination)
      copied++
    } catch (error) {
      const done = copied > 0 ? ` (${copied} of ${hostPaths.length} copied before)` : ''
      return { status: 'error', message: `Could not copy "${baseName(hostPath)}"${done}: ${messageOf(error)}` }
    }
    if (!(await giveToSandboxUser(sandbox, joinSandboxPath(destination, baseName(hostPath))))) {
      ownershipFixed = false
    }
  }

  const what = hostPaths.length === 1 ? `"${baseName(hostPaths[0] ?? '')}"` : `${hostPaths.length} items`
  const note = ownershipFixed ? '' : ' (the sandbox user may not be able to change them: they belong to root)'
  log.info('files', `Uploaded ${hostPaths.length} item(s) to ${sandbox}:${destination}${ownershipFixed ? '' : ' (ownership not changed)'}: ${hostPaths.slice(0, 20).join(', ')}`)
  return { status: 'done', message: `Copied ${what} to ${sandbox}:${destination}${note}` }
}

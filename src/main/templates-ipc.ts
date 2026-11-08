import { dialog, ipcMain, type BaseWindow, type IpcMainInvokeEvent } from 'electron'
import { isValidSandboxName, SANDBOX_IPC, type ActionResult } from '../shared/sandbox'
import {
  TEMPLATES_IPC,
  formatTemplateSize,
  isValidTemplateId,
  validateTemplateTag,
  type TemplateInfo,
  type TemplateListResult,
  type TemplatesContext
} from '../shared/templates'
import type { TransferResult } from '../shared/transfer'
import type { DialogHost } from './dialogs'
import { log, untrustedSender } from './logger'
import { listSandboxes } from './sandboxes'
import { SbxError } from './sbx'
import { listTemplates, loadTemplate, removeTemplate, saveTemplate } from './templates'
import type { AppWindow } from './window'

function messageOf(error: unknown): string {
  return error instanceof SbxError || error instanceof Error ? error.message : String(error)
}

const cancelled = (): TransferResult => ({ status: 'cancelled', message: 'Cancelled.' })

/** Asks before saving a snapshot of a sandbox that is running. "Cancel" is the default answer. */
async function confirmSaveRunning(parent: BaseWindow, sandbox: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning',
    buttons: ['Save anyway', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Save a running sandbox?',
    message: `"${sandbox}" is running.`,
    detail:
      'Taking a snapshot of a running sandbox may interrupt it or stop it, which ends everything running ' +
      'inside (for example the web UI). Stop the sandbox first if you want to be sure that nothing is lost.'
  })
  return response === 0
}

/** Asks before deleting a template. "Cancel" is the default answer. */
async function confirmRemove(parent: BaseWindow, template: TemplateInfo): Promise<boolean> {
  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete template?',
    message: `Delete the template "${template.name}:${template.tag}"?`,
    detail:
      `It uses ${formatTemplateSize(template.size)} on this computer. This cannot be undone.\n\n` +
      'Sandboxes that were created from it keep running, but a sandbox can only be saved as a template while ' +
      'the image it was created from is still available.'
  })
  return response === 0
}

/**
 * IPC for the Templates dialog (`sbx template`). The dialog is opened for one sandbox; saving
 * snapshots that sandbox. The dialog names a template name or a template id; the main process
 * validates them, picks every file on this computer in native dialogs and asks before anything
 * that cannot be undone.
 */
export function registerTemplatesIpc(app: AppWindow, dialogs: DialogHost): void {
  /** Sandbox the dialog was opened for. */
  let sandbox: string | null = null
  let running = false
  /** True while a save, load or delete runs: they are heavy and must not overlap. */
  let busy = false

  const assertFromTemplates = (event: IpcMainInvokeEvent): string => {
    if (!dialogs.isTrusted('templates', event) || sandbox === null) throw untrustedSender()
    return sandbox
  }

  /** Runs one heavy operation; a second request while one runs is refused. */
  const exclusive = async (work: () => Promise<TransferResult>): Promise<TransferResult> => {
    if (busy) return { status: 'error', message: 'Another template operation is still running.' }
    busy = true
    try {
      return await work()
    } catch (error) {
      return { status: 'error', message: messageOf(error) }
    } finally {
      busy = false
    }
  }

  // From the Sandboxes dialog.
  ipcMain.handle(SANDBOX_IPC.openTemplates, async (event, name: unknown): Promise<ActionResult> => {
    if (!dialogs.isTrusted('sandboxes', event)) throw untrustedSender()
    if (typeof name !== 'string' || !isValidSandboxName(name)) return { ok: false, message: 'Invalid sandbox name.' }
    try {
      const info = (await listSandboxes()).find((item) => item.name === name)
      if (!info) return { ok: false, message: 'That sandbox does not exist.' }
      sandbox = name
      running = info.running
      dialogs.open('templates')
      return { ok: true }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(TEMPLATES_IPC.context, (event): TemplatesContext => {
    const name = assertFromTemplates(event)
    return { sandbox: name, running }
  })

  ipcMain.handle(TEMPLATES_IPC.list, async (event): Promise<TemplateListResult> => {
    assertFromTemplates(event)
    try {
      return { ok: true, templates: await listTemplates() }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(TEMPLATES_IPC.save, (event, tag: unknown, exportFile: unknown) => {
    const name = assertFromTemplates(event)
    return exclusive(async () => {
      if (typeof tag !== 'string' || typeof exportFile !== 'boolean') return { status: 'error', message: 'Invalid request.' }
      const problem = validateTemplateTag(tag)
      if (problem !== null) return { status: 'error', message: problem }
      const wanted = tag.trim()

      // Look again: the sandbox may have been started or removed since the dialog opened.
      const info = (await listSandboxes()).find((item) => item.name === name)
      if (!info) return { status: 'error', message: 'That sandbox does not exist any more.' }
      running = info.running
      if (running && !(await confirmSaveRunning(app.window, name))) return cancelled()

      let target: string | null = null
      if (exportFile) {
        const picked = await dialog.showSaveDialog(app.window, {
          title: 'Export the template as a tar file',
          defaultPath: `${wanted.replace(/[\\/:*?"<>|]/g, '_')}.tar`,
          filters: [{ name: 'Tar archive', extensions: ['tar'] }]
        })
        if (picked.canceled || picked.filePath === undefined) return cancelled()
        target = picked.filePath
      }

      log.info('templates', `Saving ${name} as template ${wanted}${target ? ` and exporting it to ${target}` : ''}`)
      await saveTemplate(name, wanted, target)
      log.info('templates', `Saved ${name} as template ${wanted}`)
      return { status: 'done', message: `Saved "${name}" as the template "${wanted}".${target ? ` Exported to ${target}.` : ''}` }
    })
  })

  ipcMain.handle(TEMPLATES_IPC.load, (event) => {
    assertFromTemplates(event)
    return exclusive(async () => {
      const picked = await dialog.showOpenDialog(app.window, {
        title: 'Choose a template tar file',
        properties: ['openFile'],
        filters: [{ name: 'Tar archive', extensions: ['tar'] }, { name: 'All files', extensions: ['*'] }]
      })
      const file = picked.filePaths[0]
      if (picked.canceled || file === undefined) return cancelled()
      log.info('templates', `Loading a template from ${file}`)
      await loadTemplate(file)
      return { status: 'done', message: `Loaded the template from ${file}.` }
    })
  })

  ipcMain.handle(TEMPLATES_IPC.remove, (event, id: unknown) => {
    assertFromTemplates(event)
    return exclusive(async () => {
      if (!isValidTemplateId(id)) return { status: 'error', message: 'Invalid template.' }
      // Only a template that exists right now, named by what the runtime itself reports.
      const template = (await listTemplates()).find((item) => item.id === id)
      if (!template) return { status: 'error', message: 'That template does not exist any more.' }
      if (!(await confirmRemove(app.window, template))) {
        log.info('templates', `Deleting the template ${template.name}:${template.tag} was cancelled by the user.`)
        return cancelled()
      }
      await removeTemplate(template.id)
      log.info('templates', `Deleted the template ${template.name}:${template.tag} (${template.id})`)
      return { status: 'done', message: `Deleted the template "${template.name}:${template.tag}".` }
    })
  })

  ipcMain.handle(TEMPLATES_IPC.back, (event) => {
    assertFromTemplates(event)
    dialogs.open('sandboxes')
  })
}

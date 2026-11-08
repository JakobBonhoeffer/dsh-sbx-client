import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { ListResult } from '../shared/explorer'
import { isValidLineCount } from '../shared/log-view'
import {
  LOGS_IPC,
  MAX_SAVE_CHARS,
  type LogFindResult,
  type LogSource,
  type LogOpenResult,
  type LogPollResult,
  type LogsContext
} from '../shared/logs'
import { baseName, resolveSandboxPath } from '../shared/sandbox-path'
import { isValidSandboxName, SANDBOX_IPC, type ActionResult } from '../shared/sandbox'
import { validateSandboxPath, type TransferResult } from '../shared/transfer'
import type { DialogHost } from './dialogs'
import { listDirectory } from './files'
import { findAppLogs, findLogs, openLog, pollLog, type LogCursor, type LogTarget } from './log-reader'
import { getLogDirectory, log, untrustedSender } from './logger'
import { listSandboxes } from './sandboxes'
import { SbxError } from './sbx'
import { getSettings } from './settings'
import { getSandboxHome, requireRunningSandbox } from './transfer'
import type { AppWindow } from './window'

function messageOf(error: unknown): string {
  return error instanceof SbxError || error instanceof Error ? error.message : String(error)
}

/** Folders searched for logs besides the home folder and the shared folders. */
const COMMON_LOG_FOLDERS = ['/var/log', '/tmp']

/** What other parts of the app need from the Logs dialog. */
export interface LogsOpener {
  /** Opens the Logs dialog for a running sandbox, optionally with a file loaded at once. */
  openFor: (sandbox: string, path: string | null) => void
  /** Opens the Logs dialog showing the app's own log (no sandbox needed). */
  openApp: () => void
}

/**
 * IPC for the Logs (log viewer) dialog. The dialog names a file in the sandbox and a number of
 * lines; everything else is decided here: the sandbox is the one the dialog was opened for, paths
 * are validated again, the search folders come from the main process, reading happens with fixed
 * scripts, and tokens are masked according to the Settings.
 */
export function registerLogsIpc(app: AppWindow, dialogs: DialogHost): LogsOpener {
  /** Sandbox the Logs dialog was opened for (null: only the app's own log), and what to show first. */
  let sandbox: string | null = null
  let initialSource: LogSource = 'sandbox'
  let initialPath: string | null = null
  let opened = false
  let home: string | null = null
  /** The file that is open in the viewer. Replaced by every `open`; a poll for an older one is dropped. */
  let cursor: LogCursor | null = null

  const assertFromLogs = (event: IpcMainInvokeEvent): string | null => {
    if (!dialogs.isTrusted('logs', event) || !opened) throw untrustedSender()
    return sandbox
  }

  /** For calls that only make sense with a sandbox. */
  const sandboxFor = (event: IpcMainInvokeEvent): string => {
    const name = assertFromLogs(event)
    if (name === null) throw new SbxError('No sandbox is selected.', 'failed')
    return name
  }

  /** Turns a source and the page's path into what the reader needs, or throws a message for the user. */
  const targetFor = async (name: string | null, source: unknown, pathInput: unknown): Promise<LogTarget> => {
    // The dialog was opened for one kind of log; the page cannot switch to the other.
    if (source !== initialSource) throw new SbxError('That log is not available in this dialog.', 'failed')
    if (source === 'app') {
      const directory = getLogDirectory()
      if (directory === null) throw new SbxError('The app has no log folder.', 'failed')
      if (typeof pathInput !== 'string') throw new SbxError('Invalid file name.', 'failed')
      return { kind: 'app', directory, fileName: pathInput }
    }
    if (source !== 'sandbox' || name === null) throw new SbxError('No sandbox is selected.', 'failed')
    await requireRunningSandbox(name)
    return { kind: 'sandbox', sandbox: name, path: await resolvePath(name, pathInput) }
  }

  const resolvePath = async (name: string, input: unknown): Promise<string> => {
    if (typeof input !== 'string') throw new SbxError('Invalid path.', 'failed')
    const problem = validateSandboxPath(input)
    if (problem !== null) throw new SbxError(problem, 'failed')
    if (input.trim().startsWith('~') && home === null) home = await getSandboxHome(name)
    const resolved = resolveSandboxPath(input, home)
    if (resolved === null) throw new SbxError('Could not determine the home folder of the sandbox.', 'failed')
    return resolved
  }

  const openFor = (name: string, path: string | null): void => {
    sandbox = name
    initialSource = 'sandbox'
    initialPath = path
    opened = true
    home = null
    cursor = null
    // An open Logs dialog would only be focused, not reloaded: close it so it starts fresh for the new source.
    dialogs.close()
    dialogs.open('logs')
  }

  const openApp = (): void => {
    // The app's own log has nothing to do with a sandbox: the dialog shows only that.
    sandbox = null
    initialSource = 'app'
    initialPath = null
    opened = true
    cursor = null
    // An open Logs dialog would only be focused, not reloaded: close it so it starts fresh for the new source.
    dialogs.close()
    dialogs.open('logs')
  }

  // From the Sandboxes dialog.
  ipcMain.handle(SANDBOX_IPC.openLogs, async (event, name: unknown): Promise<ActionResult> => {
    if (!dialogs.isTrusted('sandboxes', event)) throw untrustedSender()
    if (typeof name !== 'string' || !isValidSandboxName(name)) {
      return { ok: false, message: 'Invalid sandbox name.' }
    }
    try {
      await requireRunningSandbox(name)
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
    openFor(name, null)
    return { ok: true }
  })

  ipcMain.handle(LOGS_IPC.context, async (event): Promise<LogsContext | null> => {
    const name = assertFromLogs(event)
    home = name === null ? null : await getSandboxHome(name).catch(() => null)
    const info = name === null ? undefined : (await listSandboxes().catch(() => [])).find((item) => item.name === name)
    return {
      sandbox: name,
      initialSource,
      home,
      mounts: (info?.mounts ?? []).map((mount) => ({ sandboxPath: mount.sandboxPath, readOnly: mount.readOnly })),
      maskTokens: getSettings().maskTokens,
      initialPath
    }
  })

  ipcMain.handle(LOGS_IPC.find, async (event, source: unknown): Promise<LogFindResult> => {
    const name = assertFromLogs(event)
    try {
      if (source !== initialSource) return { ok: false, message: 'That log is not available in this dialog.' }
      if (source === 'app') {
        const directory = getLogDirectory()
        return { ok: true, files: directory === null ? [] : await findAppLogs(directory) }
      }
      if (source !== 'sandbox' || name === null) return { ok: false, message: 'No sandbox is selected.' }
      await requireRunningSandbox(name)
      const info = (await listSandboxes()).find((item) => item.name === name)
      const roots = new Set<string>()
      if (home !== null) roots.add(home)
      for (const mount of info?.mounts ?? []) if (mount.sandboxPath.startsWith('/')) roots.add(mount.sandboxPath)
      for (const folder of COMMON_LOG_FOLDERS) roots.add(folder)
      return { ok: true, files: await findLogs(name, [...roots]) }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(LOGS_IPC.open, async (event, source: unknown, pathInput: unknown, lines: unknown): Promise<LogOpenResult> => {
    const name = assertFromLogs(event)
    try {
      if (!isValidLineCount(lines)) return { ok: false, message: 'Invalid number of lines.' }
      const target = await targetFor(name, source, pathInput)
      // Only a valid request replaces what the viewer follows; a refused one leaves it as it was.
      cursor = null
      // The app's own log never holds a token (it is masked when written), so it is shown as it is.
      const mask = target.kind === 'sandbox' && getSettings().maskTokens
      const loaded = await openLog(target, lines, mask)
      cursor = loaded.cursor
      const path = target.kind === 'app' ? target.fileName : target.path
      log.info('logs', `Opened ${target.kind === 'app' ? 'the app log ' : `${name}:`}${path} (${loaded.size} bytes, last ${lines} lines)`)
      return {
        ok: true,
        path,
        size: loaded.size,
        cutStart: loaded.cutStart,
        lines: loaded.lines,
        partial: loaded.partial
      }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(LOGS_IPC.poll, async (event): Promise<LogPollResult> => {
    const name = assertFromLogs(event)
    const mine = cursor
    if (mine === null || (mine.target.kind === 'sandbox' && mine.target.sandbox !== name)) {
      return { ok: false, message: 'No log is open.' }
    }
    try {
      const mask = mine.target.kind === 'sandbox' && getSettings().maskTokens
      const result = await pollLog(mine, mask)
      if (cursor !== mine) return { ok: false, message: 'The log was changed meanwhile.' }
      if (!result.reset) {
        return { ok: true, reset: false, size: result.size, lines: result.lines, partial: result.partial }
      }
      // The file became smaller: load it again from the end.
      const loaded = await openLog(mine.target, mine.lineCount, mask)
      if (cursor !== mine) return { ok: false, message: 'The log was changed meanwhile.' }
      cursor = loaded.cursor
      return { ok: true, reset: true, size: loaded.size, lines: loaded.lines, partial: loaded.partial }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  // Listing for the "Browse…" picker: read-only, same command and limits as the file browser.
  ipcMain.handle(LOGS_IPC.list, async (event, input: unknown): Promise<ListResult> => {
    let name: string
    try {
      name = sandboxFor(event)
    } catch (error) {
      if (error instanceof SbxError) return { ok: false, message: error.message }
      throw error
    }
    try {
      await requireRunningSandbox(name)
      const path = await resolvePath(name, input)
      const { entries, truncated } = await listDirectory(name, path)
      return { ok: true, path, entries, truncated }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(LOGS_IPC.save, async (event, text: unknown, suggestedName: unknown): Promise<TransferResult> => {
    assertFromLogs(event)
    try {
      if (typeof text !== 'string' || text.length > MAX_SAVE_CHARS) {
        return { status: 'error', message: 'There is nothing to save, or it is too large.' }
      }
      // The page only suggests a name; it is reduced to a plain file name here.
      const plain = typeof suggestedName === 'string' ? baseName(suggestedName) : ''
      const fileName = plain.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100) || 'log.txt'
      const picked = await dialog.showSaveDialog(app.window, {
        title: 'Save the log text on this computer',
        defaultPath: fileName,
        filters: [{ name: 'Text', extensions: ['txt', 'log'] }]
      })
      if (picked.canceled || picked.filePath === undefined) return { status: 'cancelled', message: 'Cancelled.' }
      await writeFile(picked.filePath, text, 'utf8')
      log.info('logs', `Saved ${text.length} characters of a log view to ${picked.filePath}`)
      return { status: 'done', message: `Saved to ${picked.filePath}` }
    } catch (error) {
      return { status: 'error', message: messageOf(error) }
    }
  })

  ipcMain.handle(LOGS_IPC.back, (event) => {
    assertFromLogs(event)
    dialogs.open('sandboxes')
  })

  return { openFor, openApp }
}

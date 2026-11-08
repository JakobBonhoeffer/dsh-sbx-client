import { app as electronApp, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { statSync } from 'node:fs'
import { DIALOG_IPC } from '../shared/dialog'
import { IPC, isMenuKey } from '../shared/ipc'
import { isLogLevel } from '../shared/logging'
import {
  isValidPort,
  isValidSandboxName,
  SANDBOX_IPC,
  type ActionResult,
  type SandboxListResult
} from '../shared/sandbox'
import {
  SETTINGS_IPC,
  validateSbxPath,
  validateTokenCommand,
  type AboutInfo,
  type AppSettings,
  type LogInfo,
  type SaveResult,
  type SbxTestResult
} from '../shared/settings'
import type { ConnectionManager } from './connection'
import type { DialogHost } from './dialogs'
import type { AppMenus } from './menu'
import { registerExplorerIpc } from './explorer-ipc'
import { registerLogsIpc } from './logs-ipc'
import { registerTemplatesIpc } from './templates-ipc'
import { registerTransferIpc } from './transfer-ipc'
import { buildLoginUrl, LOOPBACK_IPV4, pickAutoConnectUrl } from './address'
import { getLogDirectory, isLogFallback, log, setLogLevel, untrustedSender } from './logger'
import { fetchLoginToken, listSandboxes, startSandbox, stopSandbox } from './sandboxes'
import { runSbx, SbxError } from './sbx'
import { getSettings, updateSettings } from './settings'
import type { AppWindow } from './window'

function messageOf(error: unknown): string {
  return error instanceof SbxError || error instanceof Error ? error.message : String(error)
}

/** How long the app keeps waiting for the web UI after it started a sandbox. */
const AFTER_START_WAIT_MS = 90_000

const buildAddress = (hostPort: number): string => `http://${LOOPBACK_IPV4}:${hostPort}/`

/**
 * Registers every IPC handler. Each group accepts calls only from the view it belongs to:
 * the local chrome view, the Sandboxes dialog or the Settings dialog. The remote view has no
 * preload and can never reach any of them.
 */
export function registerIpc(
  app: AppWindow,
  connection: ConnectionManager,
  dialogs: DialogHost,
  menus: AppMenus
): void {
  const assertFromChrome = (event: IpcMainInvokeEvent): void => {
    const isChrome = event.sender === app.chromeView.webContents
    const isMainFrame = event.senderFrame === event.sender.mainFrame
    if (!isChrome || !isMainFrame) {
      throw untrustedSender()
    }
  }

  const assertFromDialog = (key: 'sandboxes' | 'settings', event: IpcMainInvokeEvent): void => {
    if (!dialogs.isTrusted(key, event)) {
      throw untrustedSender()
    }
  }

  ipcMain.handle(DIALOG_IPC.close, (event) => {
    if (!dialogs.isFromOpenDialog(event)) {
      throw untrustedSender()
    }
    dialogs.close()
  })

  // --- Main window toolbar -------------------------------------------------------------------

  ipcMain.handle(IPC.getState, (event) => {
    assertFromChrome(event)
    return connection.getState()
  })

  ipcMain.handle(IPC.connect, async (event, url: unknown) => {
    assertFromChrome(event)
    if (typeof url !== 'string') throw new TypeError('The address must be a string.')
    await connection.connect(url)
  })

  ipcMain.handle(IPC.disconnect, async (event, options: unknown) => {
    assertFromChrome(event)
    const signOut =
      typeof options === 'object' && options !== null && (options as { signOut?: unknown }).signOut === true
    await connection.disconnect({ signOut })
  })

  ipcMain.handle(IPC.openSandboxes, (event) => {
    assertFromChrome(event)
    dialogs.open('sandboxes')
  })

  ipcMain.handle(IPC.openSettings, (event) => {
    assertFromChrome(event)
    dialogs.open('settings')
  })

  ipcMain.handle(IPC.openMenu, (event, menu: unknown, x: unknown, y: unknown) => {
    assertFromChrome(event)
    if (!isMenuKey(menu)) throw new TypeError('Unknown menu.')
    // Finite numbers only; the position is just where the popup appears.
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError('Invalid menu position.')
    }
    menus.popup(menu, x, y)
  })

  registerTransferIpc(app, dialogs)
  const logs = registerLogsIpc(app, dialogs)
  registerExplorerIpc(app, dialogs, logs)
  menus.onApplicationLog = logs.openApp
  registerTemplatesIpc(app, dialogs)

  // --- Sandboxes dialog ----------------------------------------------------------------------

  ipcMain.handle(SANDBOX_IPC.list, async (event): Promise<SandboxListResult> => {
    assertFromDialog('sandboxes', event)
    try {
      return {
        ok: true,
        sandboxes: await listSandboxes(),
        loginAvailable: getSettings().tokenCommand.trim() !== ''
      }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  /**
   * The renderer only names a sandbox and a port. Both are validated here, and a fresh listing
   * proves that this port really belongs to that running sandbox before anything is done with it.
   */
  const checkPublishedPort = async (name: unknown, hostPort: unknown): Promise<ActionResult | null> => {
    if (typeof name !== 'string' || !isValidSandboxName(name)) {
      return { ok: false, message: 'Invalid sandbox name.' }
    }
    if (typeof hostPort !== 'number' || !isValidPort(hostPort)) {
      return { ok: false, message: 'Invalid port.' }
    }
    try {
      const sandbox = (await listSandboxes()).find((item) => item.name === name)
      if (!sandbox?.running || !sandbox.ports.some((port) => port.hostPort === hostPort)) {
        return { ok: false, message: 'That port is not published by a running sandbox.' }
      }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
    return null
  }

  ipcMain.handle(SANDBOX_IPC.connect, async (event, name: unknown, hostPort: unknown): Promise<ActionResult> => {
    assertFromDialog('sandboxes', event)
    const problem = await checkPublishedPort(name, hostPort)
    if (problem) return problem

    // Show the result in the main window: close the dialog, then connect.
    log.info('sandbox', `Connecting to ${name as string} on port ${hostPort as number}`)
    dialogs.close()
    await connection.connect(buildAddress(hostPort as number))
    return { ok: true }
  })

  ipcMain.handle(
    SANDBOX_IPC.connectWithLogin,
    async (event, name: unknown, hostPort: unknown): Promise<ActionResult> => {
      assertFromDialog('sandboxes', event)
      const command = getSettings().tokenCommand.trim()
      if (command === '') {
        return { ok: false, message: 'No token command is set. Add one in Settings, under Docker Sandboxes.' }
      }
      const problem = await checkPublishedPort(name, hostPort)
      if (problem) return problem

      // Both values were validated by checkPublishedPort.
      log.info('sandbox', `Fetching a login token from ${name as string} with the login command (the token is not logged)`)
      const token = await fetchLoginToken(name as string, command, hostPort as number).catch((error: unknown) => error)
      if (typeof token !== 'string') {
        log.warn('sandbox', `The login command failed: ${messageOf(token)}`)
        return { ok: false, message: messageOf(token) }
      }

      dialogs.close()
      await connection.connect(buildLoginUrl(hostPort as number, token))
      return { ok: true }
    }
  )

  ipcMain.handle(SANDBOX_IPC.openMount, async (event, name: unknown, hostPath: unknown): Promise<ActionResult> => {
    assertFromDialog('sandboxes', event)
    if (typeof name !== 'string' || !isValidSandboxName(name)) {
      return { ok: false, message: 'Invalid sandbox name.' }
    }
    if (typeof hostPath !== 'string' || hostPath === '') {
      return { ok: false, message: 'Invalid folder.' }
    }

    try {
      // Only a path that this sandbox really mounts (fresh listing, exact match) may be opened.
      const sandbox = (await listSandboxes()).find((item) => item.name === name)
      if (!sandbox) return { ok: false, message: 'That sandbox does not exist.' }
      const mount = sandbox.mounts.find((item) => item.hostPath === hostPath)
      if (!mount) return { ok: false, message: 'That folder is not mounted into this sandbox.' }

      let isDirectory: boolean
      try {
        isDirectory = statSync(mount.hostPath).isDirectory()
      } catch {
        return { ok: false, message: 'That folder does not exist on this computer anymore.' }
      }

      log.info('sandbox', `Opening the shared folder ${mount.hostPath} of ${name}`)
      if (isDirectory) {
        // openPath returns an error text, or an empty string on success.
        const error = await shell.openPath(mount.hostPath)
        return error === '' ? { ok: true } : { ok: false, message: error }
      }
      // A mounted single file is only revealed, never opened: opening it could run it.
      shell.showItemInFolder(mount.hostPath)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(SANDBOX_IPC.start, async (event, name: unknown): Promise<ActionResult> => {
    assertFromDialog('sandboxes', event)
    if (typeof name !== 'string' || !isValidSandboxName(name)) {
      return { ok: false, message: 'Invalid sandbox name.' }
    }

    try {
      // Only existing, stopped sandboxes are started: `sbx run` would create unknown names.
      const before = (await listSandboxes()).find((item) => item.name === name)
      if (!before) return { ok: false, message: 'That sandbox does not exist.' }
      if (before.running) return { ok: false, message: 'That sandbox is already running.' }

      log.info('sandbox', `Starting sandbox ${name}`)
      await startSandbox(name)
      log.info('sandbox', `Sandbox ${name} started`)

      // Bring the page back if the user was working with this sandbox before: reconnect to the
      // last address when it is one of this sandbox's ports, once the web UI answers.
      const after = (await listSandboxes()).find((item) => item.name === name)
      const url = pickAutoConnectUrl(getSettings().lastUrl, after?.ports ?? [])
      if (url !== null) {
        dialogs.close()
        void connection.connect(url, { waitForHostMs: AFTER_START_WAIT_MS })
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(SANDBOX_IPC.stop, async (event, name: unknown): Promise<ActionResult> => {
    assertFromDialog('sandboxes', event)
    if (typeof name !== 'string' || !isValidSandboxName(name)) {
      return { ok: false, message: 'Invalid sandbox name.' }
    }

    try {
      const sandbox = (await listSandboxes()).find((item) => item.name === name)
      if (!sandbox) return { ok: false, message: 'That sandbox does not exist.' }
      if (!sandbox.running) return { ok: false, message: 'That sandbox is not running.' }

      // If the main window shows this sandbox, disconnect first so it does not end on an error page.
      const state = connection.getState()
      if (state.status !== 'disconnected' && pickAutoConnectUrl(state.url, sandbox.ports) !== null) {
        await connection.disconnect({ signOut: false })
      }

      log.info('sandbox', `Stopping sandbox ${name}`)
      await stopSandbox(name)
      log.info('sandbox', `Sandbox ${name} stopped`)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  // --- Settings dialog -----------------------------------------------------------------------

  ipcMain.handle(SETTINGS_IPC.about, (event): AboutInfo => {
    assertFromDialog('settings', event)
    return { name: electronApp.getName(), version: electronApp.getVersion() }
  })

  ipcMain.handle(SETTINGS_IPC.get, (event): AppSettings => {
    assertFromDialog('settings', event)
    const { sbxPath, tokenCommand, logLevel, maskTokens } = getSettings()
    return { sbxPath, tokenCommand, logLevel, maskTokens }
  })

  ipcMain.handle(SETTINGS_IPC.save, (event, value: unknown): SaveResult => {
    assertFromDialog('settings', event)
    const input = value as Record<string, unknown> | null
    const sbxPath = input?.['sbxPath']
    const tokenCommand = input?.['tokenCommand']
    const logLevel = input?.['logLevel']
    const maskTokens = input?.['maskTokens']
    if (
      typeof sbxPath !== 'string' ||
      typeof tokenCommand !== 'string' ||
      !isLogLevel(logLevel) ||
      typeof maskTokens !== 'boolean'
    ) {
      log.warn('settings', 'Rejected a save request with invalid values.')
      return { ok: false, message: 'Invalid settings.' }
    }
    const problem = validateSbxPath(sbxPath) ?? validateTokenCommand(tokenCommand)
    if (problem !== null) return { ok: false, message: problem }

    try {
      const before = getSettings()
      const saved = updateSettings({
        sbxPath: sbxPath.trim(),
        tokenCommand: tokenCommand.trim(),
        logLevel,
        maskTokens
      })
      // Log which settings changed, but never the value of the login command (it may hold a path or a secret).
      const changed = (['sbxPath', 'tokenCommand', 'logLevel', 'maskTokens'] as const).filter(
        (key) => before[key] !== saved[key]
      )
      if (changed.length > 0) log.info('settings', `Changed: ${changed.join(', ')}`)
      setLogLevel(saved.logLevel)
      return {
        ok: true,
        settings: {
          sbxPath: saved.sbxPath,
          tokenCommand: saved.tokenCommand,
          logLevel: saved.logLevel,
          maskTokens: saved.maskTokens
        }
      }
    } catch (error) {
      log.error('settings', `Could not save settings: ${messageOf(error)}`)
      return { ok: false, message: `Could not save settings: ${messageOf(error)}` }
    }
  })

  ipcMain.handle(SETTINGS_IPC.logInfo, (event): LogInfo => {
    assertFromDialog('settings', event)
    return { directory: getLogDirectory(), fallback: isLogFallback() }
  })

  ipcMain.handle(SETTINGS_IPC.openLogFolder, async (event): Promise<ActionResult> => {
    assertFromDialog('settings', event)
    // The folder is whatever the logger chose, never a path from the page.
    const directory = getLogDirectory()
    if (directory === null) return { ok: false, message: 'Logging has not started.' }
    const error = await shell.openPath(directory)
    return error === '' ? { ok: true } : { ok: false, message: error }
  })

  ipcMain.handle(SETTINGS_IPC.testSbx, async (event, value: unknown): Promise<SbxTestResult> => {
    assertFromDialog('settings', event)
    if (typeof value !== 'string') return { ok: false, message: 'Invalid path.' }
    const problem = validateSbxPath(value)
    if (problem !== null) return { ok: false, message: problem }

    try {
      const output = await runSbx(['version'], { executable: value.trim(), timeoutMs: 10_000 })
      return { ok: true, message: output.trim().split(/\r?\n/, 1)[0] ?? 'OK' }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })
}

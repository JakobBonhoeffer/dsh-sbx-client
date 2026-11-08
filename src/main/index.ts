import { app, dialog } from 'electron'
import { DEFAULT_URL } from '../shared/ipc'
import { ConnectionManager } from './connection'
import { registerIpc } from './ipc'
import { describeError, initLogger, log } from './logger'
import { AppMenus } from './menu'
import { DialogHost } from './dialogs'
import { getSettings } from './settings'
import { createAppWindow, type AppWindow } from './window'

app.setName('dsh-sbx-client')
app.setAppUserModelId('dsh-sbx-client')

let mainWindow: AppWindow | null = null

function start(): void {
  mainWindow = createAppWindow()
  const connection = new ConnectionManager(mainWindow, DEFAULT_URL)
  const dialogs = new DialogHost(mainWindow)
  const menus = new AppMenus(mainWindow, dialogs)
  menus.install()
  registerIpc(mainWindow, connection, dialogs, menus)
  log.info('app', 'Main window created.')

  mainWindow.window.on('closed', () => {
    mainWindow = null
    app.quit()
  })
}

// Only one instance: a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Only the running instance writes the log; a second launch that quits at once stays out of it.
  initLogger(getSettings().logLevel)
  log.info(
    'app',
    `Starting dsh-sbx-client ${app.getVersion()} (Electron ${process.versions['electron']}, ` +
      `Node ${process.versions.node}, ${process.platform} ${process.arch}, ${app.isPackaged ? 'packaged' : 'development'})`
  )

  // Anything that escapes normal handling ends up in the log, with its stack.
  process.on('uncaughtException', (error) => {
    log.error('app', `Uncaught exception: ${describeError(error)}`)
    // Without a handler Electron would have shown an error dialog; keep telling the user.
    dialog.showErrorBox('dsh-sbx-client', error instanceof Error ? error.message : String(error))
  })
  process.on('unhandledRejection', (reason) => {
    log.error('app', `Unhandled promise rejection: ${describeError(reason)}`)
  })
  app.on('render-process-gone', (_event, contents, details) => {
    log.error('app', `A renderer process ended (${details.reason}, exit code ${details.exitCode}) at ${contents.getURL()}`)
  })
  app.on('child-process-gone', (_event, details) => {
    log.warn('app', `A ${details.type} process ended (${details.reason}, exit code ${details.exitCode}).`)
  })
  app.on('before-quit', () => log.info('app', 'Exiting.'))

  app.on('second-instance', () => {
    log.info('app', 'A second launch was started; focusing the existing window.')
    const window = mainWindow?.window
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(start)

  // The app has a single window, so closing it ends the app on every platform.
  app.on('window-all-closed', () => {
    app.quit()
  })
}

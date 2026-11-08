import { app, nativeTheme, WebContentsView, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { log, logWebContents } from './logger'
import type { AppWindow } from './window'

export type DialogKey = 'sandboxes' | 'settings' | 'transfer' | 'explorer' | 'logs' | 'templates'

interface DialogSpec {
  /** HTML page in the renderer bundle. */
  page: string
  /** Preload script in the preload bundle. */
  preload: string
  /** Preferred size in DIP; shrunk to fit small windows. */
  width: number
  height: number
}

const SPECS: Record<DialogKey, DialogSpec> = {
  sandboxes: { page: 'sandbox.html', preload: 'sandbox.js', width: 720, height: 560 },
  settings: { page: 'settings.html', preload: 'settings.js', width: 840, height: 520 },
  transfer: { page: 'transfer.html', preload: 'transfer.js', width: 780, height: 640 },
  explorer: { page: 'explorer.html', preload: 'explorer.js', width: 1000, height: 680 },
  logs: { page: 'logs.html', preload: 'logs.js', width: 1000, height: 680 },
  templates: { page: 'templates.html', preload: 'templates.js', width: 780, height: 640 }
}

/** Space kept free between a dialog and the edges of the main window. */
const WINDOW_MARGIN = 24

/** Corner radius of the dialog card (the view is clipped to it). */
const DIALOG_RADIUS = 12

/**
 * In-app dialogs (Sandboxes, Settings). A dialog is one more view inside the main window,
 * sized to its card and centered over the content, so it always appears in the main window on
 * whichever monitor that is and adds nothing to the taskbar. It is deliberately not full-size:
 * native views do not blend with each other, so a transparent full-window layer would hide the
 * page behind it instead of dimming it. At most one dialog is open at a time. Dialogs only load
 * bundled local pages, each with its own preload.
 */
export class DialogHost {
  private current: { key: DialogKey; view: WebContentsView } | null = null

  constructor(private readonly appWindow: AppWindow) {
    // The main window raises its toolbar view in some layouts; keep the dialog on top of it.
    appWindow.onLayout(() => this.place())
  }

  open(key: DialogKey): void {
    if (this.current?.key === key) {
      this.current.view.webContents.focus()
      return
    }
    this.close()

    const spec = SPECS[key]
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload', spec.preload),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#16161a' : '#ffffff')
    view.setBorderRadius(DIALOG_RADIUS)

    // Fixed bundled page: it never navigates and never opens windows.
    view.webContents.on('will-navigate', (event) => event.preventDefault())
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    logWebContents(view.webContents, `dialog:${key}`, true)
    log.debug('dialog', `Opened the ${key} dialog.`)

    this.current = { key, view }
    this.appWindow.window.contentView.addChildView(view)
    this.place()

    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (!app.isPackaged && rendererUrl) {
      void view.webContents.loadURL(`${rendererUrl}/${spec.page}`)
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer', spec.page))
    }
    view.webContents.once('did-finish-load', () => view.webContents.focus())
  }

  close(): void {
    const current = this.current
    if (!current) return
    this.current = null
    this.appWindow.window.contentView.removeChildView(current.view)
    if (!current.view.webContents.isDestroyed()) current.view.webContents.close()
    // Give keyboard focus back to the toolbar so shortcuts and typing keep working.
    this.appWindow.chromeView.webContents.focus()
  }

  /** True when the IPC call comes from the main frame of the open dialog with that key. */
  isTrusted(key: DialogKey, event: IpcMainInvokeEvent): boolean {
    const current = this.current
    return (
      current !== null &&
      current.key === key &&
      event.sender === current.view.webContents &&
      event.senderFrame === event.sender.mainFrame
    )
  }

  /** True when the IPC call comes from whichever dialog is open. */
  isFromOpenDialog(event: IpcMainInvokeEvent): boolean {
    const current = this.current
    return (
      current !== null &&
      event.sender === current.view.webContents &&
      event.senderFrame === event.sender.mainFrame
    )
  }

  /** Centers the dialog in the main window and keeps it above every other view. */
  private place(): void {
    const current = this.current
    if (!current) return
    const spec = SPECS[current.key]
    const content = this.appWindow.window.getContentBounds()
    const width = Math.max(0, Math.min(spec.width, content.width - 2 * WINDOW_MARGIN))
    const height = Math.max(0, Math.min(spec.height, content.height - 2 * WINDOW_MARGIN))
    current.view.setBounds({
      x: Math.round((content.width - width) / 2),
      y: Math.round((content.height - height) / 2),
      width,
      height
    })
    // Re-adding an existing child moves it to the top of the stack.
    this.appWindow.window.contentView.addChildView(current.view)
  }
}

import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuKey } from '../shared/ipc'
import type { DialogHost } from './dialogs'
import type { AppWindow } from './window'

/**
 * The application menus. They exist in two forms from one definition:
 *  - as the (hidden) application menu, so accelerators such as F5 keep working, and
 *  - as popup menus that the title bar buttons "Application" and "View" open.
 *
 * Zoom, reload and developer tools act on the remote page rather than on whichever view has
 * focus, because the toolbar is a separate view. There is deliberately no Edit menu: text
 * editing shortcuts work natively in both views. Zoom items have no accelerators because the
 * DSH web UI already uses them.
 */
export class AppMenus {
  /** Opens the app's own log in the Logs dialog. Set once the log viewer is registered. */
  onApplicationLog: () => void = () => {}

  constructor(
    private readonly app: AppWindow,
    private readonly dialogs: DialogHost
  ) {}

  /** Installs the application menu (for accelerators) and keeps the native menu bar hidden. */
  install(): void {
    const labels: Record<MenuKey, string> = { application: 'Application', view: 'View' }
    const template = (Object.keys(labels) as MenuKey[]).map(
      (key): MenuItemConstructorOptions => ({ label: labels[key], submenu: this.items(key) })
    )
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    // The title bar shows its own buttons; the native menu bar must not appear above them.
    this.app.window.setMenuBarVisibility(false)
  }

  /** Opens a popup menu at window coordinates (the bottom-left corner of a title bar button). */
  popup(key: MenuKey, x: number, y: number): void {
    Menu.buildFromTemplate(this.items(key)).popup({
      window: this.app.window,
      x: Math.round(x),
      y: Math.round(y)
    })
  }

  private items(key: MenuKey): MenuItemConstructorOptions[] {
    const remote = () => this.app.remoteView.webContents
    const zoomBy = (delta: number): void => {
      remote().setZoomLevel(remote().getZoomLevel() + delta)
    }

    if (key === 'application') {
      return [
        { label: 'Sandboxes…', click: () => this.dialogs.open('sandboxes') },
        { label: 'Settings…', click: () => this.dialogs.open('settings') },
        { label: 'Application log…', click: () => this.onApplicationLog() },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }

    return [
      { label: 'Reload page', accelerator: 'F5', click: () => remote().reload() },
      { label: 'Zoom in', click: () => zoomBy(0.5) },
      { label: 'Zoom out', click: () => zoomBy(-0.5) },
      { label: 'Actual size', click: () => remote().setZoomLevel(0) },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      {
        label: 'Toggle developer tools',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => remote().toggleDevTools()
      }
    ]
  }
}

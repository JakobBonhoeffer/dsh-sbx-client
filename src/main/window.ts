import { app, BaseWindow, nativeTheme, session, WebContentsView, type Session } from 'electron'
import { join } from 'node:path'
import { log, logWebContents } from './logger'

/**
 * Heights of the two rows at the top of the local UI. They must match `.titlebar` and `.toolbar`
 * in src/renderer/styles.css. While a remote page is shown, the local view is exactly this tall.
 */
const TITLEBAR_HEIGHT = 36
const TOOLBAR_HEIGHT = 52
const CHROME_HEIGHT = TITLEBAR_HEIGHT + TOOLBAR_HEIGHT

/**
 * Colors of the native window buttons (minimize, maximize, close) that Windows draws over the
 * title bar. They must match `--bg-titlebar` and `--fg` in src/renderer/theme.css.
 */
const TITLEBAR_COLORS = {
  dark: { color: '#121216', symbolColor: '#ececf1' },
  light: { color: '#e9e9ee', symbolColor: '#1c1c21' }
} as const

const titleBarOverlay = (): { color: string; symbolColor: string; height: number } => ({
  ...TITLEBAR_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
  height: TITLEBAR_HEIGHT
})

/** Dedicated persistent partition: keeps the host's session cookie between launches. */
const REMOTE_PARTITION = 'persist:remote'

export interface AppWindow {
  window: BaseWindow
  /** Local UI (toolbar and status panel). Has a preload script; loads only bundled files. */
  chromeView: WebContentsView
  /** Remote host UI. No preload script, sandboxed, never exposed to the IPC API. */
  remoteView: WebContentsView
  remoteSession: Session
  /** `expanded` lets the local UI fill the whole window, covering the remote view. */
  applyLayout: (expanded: boolean) => void
  /** Registers a callback that runs after every layout pass (resize or state change). */
  onLayout: (listener: () => void) => void
}

export function createAppWindow(): AppWindow {
  const window = new BaseWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 420,
    title: 'DSH sbx client',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161a' : '#ffffff',
    // No native title bar: the local UI draws its own, and Windows overlays the window buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay()
  })
  // Follow the system theme while running (the page itself switches through prefers-color-scheme).
  nativeTheme.on('updated', () => window.setTitleBarOverlay(titleBarOverlay()))

  const chromeView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const remoteSession = session.fromPartition(REMOTE_PARTITION)

  // Deny every permission request of the remote page except writing sanitized text to the
  // clipboard (copy buttons). Camera, microphone, notifications and so on stay off.
  const isAllowedPermission = (permission: string): boolean => permission === 'clipboard-sanitized-write'
  remoteSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = isAllowedPermission(permission)
    if (!allowed) log.info('remote', `Denied the permission request "${permission}" of the remote page.`)
    callback(allowed)
  })
  remoteSession.setPermissionCheckHandler((_contents, permission) => isAllowedPermission(permission))

  const remoteView = new WebContentsView({
    webPreferences: {
      session: remoteSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.contentView.addChildView(chromeView)
  window.contentView.addChildView(remoteView)

  logWebContents(chromeView.webContents, 'toolbar', true)
  logWebContents(remoteView.webContents, 'remote', false)

  let expanded = true
  const layoutListeners: Array<() => void> = []

  const applyLayout = (nextExpanded?: boolean): void => {
    if (nextExpanded !== undefined) expanded = nextExpanded
    const { width, height } = window.getContentBounds()
    // The remote view stays "visible" in both layouts. Chromium does not report a finished load
    // for hidden contents, so hiding it would leave a connect attempt waiting forever.
    if (expanded) {
      remoteView.setBounds({ x: 0, y: 0, width, height })
      chromeView.setBounds({ x: 0, y: 0, width, height })
      // Re-adding an existing child moves it to the top, so the opaque local UI covers the remote page.
      window.contentView.addChildView(chromeView)
    } else {
      chromeView.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT })
      remoteView.setBounds({
        x: 0,
        y: CHROME_HEIGHT,
        width,
        height: Math.max(0, height - CHROME_HEIGHT)
      })
    }
    for (const listener of layoutListeners) listener()
  }

  window.on('resize', () => applyLayout())
  applyLayout(true)

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && rendererUrl) {
    void chromeView.webContents.loadURL(rendererUrl)
  } else {
    void chromeView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return {
    window,
    chromeView,
    remoteView,
    remoteSession,
    applyLayout,
    onLayout: (listener) => {
      layoutListeners.push(listener)
    }
  }
}

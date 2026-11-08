import { shell } from 'electron'
import type { Event } from 'electron'
import { IPC, type ConnectionState } from '../shared/ipc'
import { log } from './logger'
import { getSettings, updateSettings } from './settings'
import { parseTargetUrl } from './target-url'
import type { AppWindow } from './window'

/** How long the reachability probe may take before the attempt is reported as failed. */
const PROBE_TIMEOUT_MS = 5000

/** How long loading the page may take after the host answered the probe. */
const LOAD_TIMEOUT_MS = 30000

/** Pause between probes while waiting for a host that is still starting. */
const READY_POLL_INTERVAL_MS = 2000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface ConnectOptions {
  /**
   * Keep probing for this long before giving up. Used right after a sandbox was started: the
   * sandbox is up, but the web UI inside it needs a few more seconds. Default: probe once.
   */
  waitForHostMs?: number
}

/** Opens a link in the system browser, but only for http(s) so no other scheme can be triggered. */
function openExternalSafe(rawUrl: string): void {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      void shell.openExternal(url.href)
    }
  } catch {
    // Ignore malformed URLs.
  }
}

export class ConnectionManager {
  private state: ConnectionState
  /** Incremented by every connect/disconnect so results of superseded attempts are dropped. */
  private attempt = 0
  /** Only this origin may be shown in the remote view; everything else goes to the browser. */
  private allowedOrigin: string | null = null

  constructor(
    private readonly app: AppWindow,
    defaultUrl: string
  ) {
    this.state = {
      status: 'disconnected',
      url: getSettings().lastUrl ?? defaultUrl,
      message: null
    }
    this.installNavigationGuards()
    this.installFailureHandlers()
  }

  getState(): ConnectionState {
    return this.state
  }

  async connect(input: string, options: ConnectOptions = {}): Promise<void> {
    const attempt = ++this.attempt
    const waitForHostMs = options.waitForHostMs ?? 0

    let target
    try {
      target = parseTargetUrl(input)
    } catch (error) {
      this.allowedOrigin = null
      this.setState({ status: 'error', url: input.trim(), message: errorMessage(error) })
      return
    }

    // Drop any previous page first so an old session cannot linger behind an error screen.
    await this.app.remoteView.webContents.loadURL('about:blank').catch(() => undefined)
    if (attempt !== this.attempt) return

    this.allowedOrigin = target.origin
    this.setState({
      status: 'connecting',
      url: target.cleanUrl,
      message: waitForHostMs > 0 ? 'Waiting for the host to answer…' : null
    })

    const probeError = await this.probeUntilReady(target.cleanUrl, target.origin, waitForHostMs, attempt)
    if (attempt !== this.attempt) return
    if (probeError !== null) {
      this.allowedOrigin = null
      this.setState({ status: 'error', url: target.cleanUrl, message: probeError })
      return
    }

    try {
      await this.loadWithTimeout(target.loadUrl)
    } catch (error) {
      if (attempt !== this.attempt) return
      this.allowedOrigin = null
      this.setState({
        status: 'error',
        url: target.cleanUrl,
        message: `The page could not be loaded (${errorMessage(error)}).`
      })
      return
    }
    if (attempt !== this.attempt) return

    try {
      updateSettings({ lastUrl: target.cleanUrl })
    } catch (error) {
      // Remembering the address is a convenience; it must never break a working connection.
      log.warn('connection', `Could not remember the address: ${errorMessage(error)}`)
    }
    this.setState({ status: 'connected', url: target.cleanUrl, message: null })

    // Chromium writes cookies to disk lazily. Flush now so the session (created by the launch
    // token exchange) survives a crash or a forced quit.
    void this.app.remoteSession.cookies.flushStore()
  }

  async disconnect(options: { signOut: boolean }): Promise<void> {
    this.attempt++
    this.allowedOrigin = null
    log.info('connection', options.signOut ? 'Disconnecting and signing out (session cookie deleted).' : 'Disconnecting.')
    // Navigating away closes the page's WebSocket connections.
    await this.app.remoteView.webContents.loadURL('about:blank').catch(() => undefined)
    if (options.signOut) {
      await this.app.remoteSession.clearStorageData()
    }
    this.setState({ status: 'disconnected', url: this.state.url, message: null })
  }

  /** Loads the page in the remote view; rejects if it does not finish within LOAD_TIMEOUT_MS. */
  private async loadWithTimeout(url: string): Promise<void> {
    const contents = this.app.remoteView.webContents
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        contents.stop()
        reject(new Error(`no response within ${LOAD_TIMEOUT_MS / 1000} seconds`))
      }, LOAD_TIMEOUT_MS)
    })
    try {
      await Promise.race([contents.loadURL(url), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Probes until the host answers or `waitMs` has passed. Returns null on success, otherwise a
   * user-facing error. Stops early (result ignored by the caller) when the attempt is superseded.
   */
  private async probeUntilReady(
    url: string,
    origin: string,
    waitMs: number,
    attempt: number
  ): Promise<string | null> {
    const deadline = Date.now() + waitMs
    for (;;) {
      const error = await this.probe(url, origin)
      if (error === null || attempt !== this.attempt) return error
      if (Date.now() + READY_POLL_INTERVAL_MS >= deadline) {
        return waitMs > 0 ? `${origin} did not answer within ${Math.round(waitMs / 1000)} seconds.` : error
      }
      await delay(READY_POLL_INTERVAL_MS)
      if (attempt !== this.attempt) return error
    }
  }

  /** Returns null when the host answers, otherwise a user-facing error message. */
  private async probe(url: string, origin: string): Promise<string | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      // Any HTTP answer (even 401/403) proves that something is listening.
      await this.app.remoteSession.fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        credentials: 'omit'
      })
      return null
    } catch {
      return controller.signal.aborted
        ? `${origin} did not answer within ${PROBE_TIMEOUT_MS / 1000} seconds.`
        : `Could not reach ${origin}. Check that the host is running and that the address and port are correct.`
    } finally {
      clearTimeout(timer)
    }
  }

  private isAllowed(rawUrl: string): boolean {
    if (rawUrl === 'about:blank') return true
    if (this.allowedOrigin === null) return false
    try {
      return new URL(rawUrl).origin === this.allowedOrigin
    } catch {
      return false
    }
  }

  private installNavigationGuards(): void {
    const contents = this.app.remoteView.webContents

    const guard = (event: Event<{ url: string }>): void => {
      if (this.isAllowed(event.url)) return
      event.preventDefault()
      openExternalSafe(event.url)
    }
    contents.on('will-navigate', guard)
    contents.on('will-redirect', guard)

    contents.setWindowOpenHandler(({ url }) => {
      if (this.isAllowed(url)) {
        void contents.loadURL(url)
      } else {
        openExternalSafe(url)
      }
      return { action: 'deny' }
    })

    // The local UI is a fixed bundled page: it never navigates and never opens windows.
    const chrome = this.app.chromeView.webContents
    chrome.on('will-navigate', (event) => event.preventDefault())
    chrome.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  /** Reports failures that happen after a successful connect (host stopped, renderer crashed). */
  private installFailureHandlers(): void {
    const contents = this.app.remoteView.webContents

    contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation was superseded, not a real failure.
      if (!isMainFrame || errorCode === -3 || this.state.status !== 'connected') return
      this.setState({
        status: 'error',
        url: this.state.url,
        message: `The connection was lost (${errorDescription}).`
      })
    })

    contents.on('render-process-gone', (_event, details) => {
      if (this.state.status !== 'connected') return
      this.setState({
        status: 'error',
        url: this.state.url,
        message: `The page stopped unexpectedly (${details.reason}).`
      })
    })
  }

  private setState(next: ConnectionState): void {
    // One log entry per transition. The address in the state never contains a launch token.
    if (next.status !== this.state.status || next.message !== this.state.message) {
      const detail = next.message === null ? '' : ` - ${next.message}`
      const text = `${next.status} ${next.url}${detail}`
      if (next.status === 'error') log.warn('connection', text)
      else log.info('connection', text)
    }
    this.state = next
    this.app.applyLayout(next.status !== 'connected')
    const chrome = this.app.chromeView.webContents
    if (!chrome.isDestroyed()) {
      chrome.send(IPC.state, next)
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

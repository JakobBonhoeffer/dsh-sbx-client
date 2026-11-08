import { isLogLevel } from '../shared/logging'
import { validateSbxPath, validateTokenCommand, type AppSettings } from '../shared/settings'
import { setupDialogClose } from './dialog-common'

setupDialogClose(() => window.settingsApi.close())

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element #${id}`)
  return found as T
}

// --- Navigation: one section visible at a time -------------------------------------------------

const navItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'))
const sections = Array.from(document.querySelectorAll<HTMLElement>('.section'))

function showSection(name: string): void {
  for (const item of navItems) {
    item.setAttribute('aria-selected', String(item.dataset['section'] === name))
  }
  for (const section of sections) {
    section.hidden = section.dataset['section'] !== name
  }
}

for (const item of navItems) {
  item.addEventListener('click', () => showSection(item.dataset['section'] ?? ''))
}

// --- Saved settings ----------------------------------------------------------------------------

/**
 * The settings as last saved. The main process stores all settings together, so a change in one
 * section is sent together with the saved values of the others (never with unsaved edits).
 */
let saved: AppSettings | null = null

// --- Docker Sandboxes section ------------------------------------------------------------------

const form = element<HTMLFormElement>('form')
const sbxPathInput = element<HTMLInputElement>('sbx-path')
const tokenCommandInput = element<HTMLInputElement>('token-command')
const saveButton = element<HTMLButtonElement>('save')
const testButton = element<HTMLButtonElement>('test')
const noticeElement = element<HTMLElement>('notice')

function showNotice(message: string | null, kind: 'error' | 'ok' = 'ok'): void {
  if (message === null) {
    noticeElement.hidden = true
    return
  }
  noticeElement.textContent = message
  noticeElement.className = `notice ${kind}`
  noticeElement.hidden = false
}

function setBusy(busy: boolean): void {
  saveButton.disabled = busy
  testButton.disabled = busy
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const problem = validateSbxPath(sbxPathInput.value) ?? validateTokenCommand(tokenCommandInput.value)
  if (problem !== null || saved === null) {
    showNotice(problem ?? 'The settings are still loading.', 'error')
    return
  }

  setBusy(true)
  void window.settingsApi
    .save({ ...saved, sbxPath: sbxPathInput.value, tokenCommand: tokenCommandInput.value })
    .then((result) => {
      if (result.ok) {
        saved = result.settings
        sbxPathInput.value = result.settings.sbxPath
        tokenCommandInput.value = result.settings.tokenCommand
        showNotice('Settings saved.')
      } else {
        showNotice(result.message, 'error')
      }
    })
    .finally(() => setBusy(false))
})

testButton.addEventListener('click', () => {
  const problem = validateSbxPath(sbxPathInput.value)
  if (problem !== null) {
    showNotice(problem, 'error')
    return
  }

  setBusy(true)
  showNotice('Testing…')
  void window.settingsApi
    .testSbx(sbxPathInput.value)
    .then((result) => showNotice(result.ok ? `Found: ${result.message}` : result.message, result.ok ? 'ok' : 'error'))
    .finally(() => setBusy(false))
})

// --- Logging section ---------------------------------------------------------------------------

const logLevelSelect = element<HTMLSelectElement>('log-level')
const maskTokensCheckbox = element<HTMLInputElement>('mask-tokens')
const logNotice = element<HTMLElement>('log-notice')
const logDir = element<HTMLElement>('log-dir')
const logDirNote = element<HTMLElement>('log-dir-note')

function showLogNotice(message: string | null, kind: 'error' | 'ok' = 'ok'): void {
  if (message === null) {
    logNotice.hidden = true
    return
  }
  logNotice.textContent = message
  logNotice.className = `notice ${kind}`
  logNotice.hidden = false
}

/** These two settings apply the moment they change; there is no Save button for them. */
function applyLoggingChange(): void {
  const level = logLevelSelect.value
  if (saved === null || !isLogLevel(level)) return

  void window.settingsApi
    .save({ ...saved, logLevel: level, maskTokens: maskTokensCheckbox.checked })
    .then((result) => {
      if (result.ok) {
        saved = result.settings
        showLogNotice('Saved.')
      } else {
        showLogNotice(result.message, 'error')
        // Show what is really stored.
        logLevelSelect.value = saved?.logLevel ?? 'info'
        maskTokensCheckbox.checked = saved?.maskTokens ?? true
      }
    })
}

logLevelSelect.addEventListener('change', applyLoggingChange)
maskTokensCheckbox.addEventListener('change', applyLoggingChange)

element<HTMLButtonElement>('open-log-folder').addEventListener('click', () => {
  void window.settingsApi.openLogFolder().then((result) => {
    if (!result.ok) showLogNotice(result.message, 'error')
  })
})

void window.settingsApi.logInfo().then((info) => {
  logDir.textContent = info.directory ?? 'Logging has not started.'
  if (info.fallback) {
    logDirNote.textContent =
      'The folder next to the app is not writable, so the log is kept in the per-user folder instead.'
    logDirNote.hidden = false
  }
})

// --- Initial values ----------------------------------------------------------------------------

void window.settingsApi.get().then((settings) => {
  saved = settings
  sbxPathInput.value = settings.sbxPath
  tokenCommandInput.value = settings.tokenCommand
  logLevelSelect.value = settings.logLevel
  maskTokensCheckbox.checked = settings.maskTokens
  sbxPathInput.focus()
  sbxPathInput.select()
})

// --- About section -----------------------------------------------------------------------------

void window.settingsApi.about().then((about) => {
  element<HTMLElement>('about-name').textContent = about.name
  element<HTMLElement>('about-version').textContent = about.version
})

import { MAX_VIEW_LINES, type FoundLog } from '../shared/log-view'
import { LOG_POLL_INTERVAL_MS, type LogSource, type LogsContext } from '../shared/logs'
import { LOG_BASE_NAME, LOG_EXTENSION } from '../shared/logging'
import { baseName, parentSandboxPath } from '../shared/sandbox-path'
import { validateSandboxPath } from '../shared/transfer'
import { setupDialogClose } from './dialog-common'
import { createFilePicker } from './file-picker'

setupDialogClose(() => window.logsApi.close())

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element #${id}`)
  return found as T
}

const pathInput = element<HTMLInputElement>('path')
const browseButton = element<HTMLButtonElement>('browse')
const openButton = element<HTMLButtonElement>('open')
const foundSelect = element<HTMLSelectElement>('found')
const followBox = element<HTMLInputElement>('follow')
const wrapBox = element<HTMLInputElement>('wrap')
const linesSelect = element<HTMLSelectElement>('lines')
const filterInput = element<HTMLInputElement>('filter')
const copyButton = element<HTMLButtonElement>('copy')
const saveButton = element<HTMLButtonElement>('save')
const noticeElement = element<HTMLElement>('notice')
const viewElement = element<HTMLElement>('view')
const statusElement = element<HTMLElement>('status')

let context: LogsContext | null = null

/** Where the log is read from: a file in the sandbox, or the app's own log on this computer. Fixed by how the dialog was opened. */
let source: LogSource = 'sandbox'

/** The file in the view, or null before one was opened. */
let openPath: string | null = null
/** Complete lines of the file (the end of it) and the unfinished last line. */
let lines: string[] = []
let partial = ''
let size = 0
let note = ''

/** Incremented by every open; answers that belong to an older one are dropped. */
let generation = 0
let pollTimer: number | undefined

function showNotice(message: string | null, kind: 'error' | 'ok' | 'info' = 'error'): void {
  if (message === null) {
    noticeElement.hidden = true
    return
  }
  noticeElement.textContent = message
  noticeElement.className = kind === 'info' ? 'notice explorer-notice' : `notice explorer-notice ${kind}`
  noticeElement.hidden = false
}

// --- Rendering ---------------------------------------------------------------------------------

/** The lines that pass the filter (case-insensitive), the unfinished last line included. */
function visibleLines(): string[] {
  const all = partial === '' ? lines : [...lines, partial]
  const needle = filterInput.value.trim().toLowerCase()
  return needle === '' ? all : all.filter((line) => line.toLowerCase().includes(needle))
}

function render(): void {
  const shown = visibleLines()
  // Keep following the end only if the reader is at the end already.
  const nearBottom = viewElement.scrollHeight - viewElement.scrollTop - viewElement.clientHeight < 40
  viewElement.textContent = shown.join('\n')
  if (nearBottom) viewElement.scrollTop = viewElement.scrollHeight

  const total = partial === '' ? lines.length : lines.length + 1
  const parts: string[] = []
  if (openPath !== null) {
    parts.push(shown.length === total ? `${total} lines` : `${shown.length} of ${total} lines match`)
    parts.push(`file size ${formatBytes(size)}`)
    if (source === 'sandbox' && context?.maskTokens) parts.push('tokens are hidden')
    if (note !== '') parts.push(note)
  }
  statusElement.textContent = parts.join(' · ')
  copyButton.disabled = shown.length === 0
  saveButton.disabled = shown.length === 0
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// --- Opening and following ---------------------------------------------------------------------

function stopPolling(): void {
  window.clearTimeout(pollTimer)
  pollTimer = undefined
}

function schedulePoll(): void {
  stopPolling()
  if (!followBox.checked || openPath === null) return
  const mine = generation
  pollTimer = window.setTimeout(() => void poll(mine), LOG_POLL_INTERVAL_MS)
}

async function poll(mine: number): Promise<void> {
  // A hidden page does not poll; it continues when it becomes visible again.
  if (mine !== generation || document.hidden) return schedulePoll()
  try {
    const result = await window.logsApi.poll()
    if (mine !== generation) return
    if (!result.ok) {
      // The file may be missing for a moment (rotation); keep trying and say so.
      showNotice(`Cannot read the log right now: ${result.message}`)
    } else {
      showNotice(null)
      size = result.size
      if (result.reset) {
        lines = result.lines
        note = 'the file was replaced or emptied'
      } else if (result.lines.length > 0) {
        lines.push(...result.lines)
        if (lines.length > MAX_VIEW_LINES) lines = lines.slice(lines.length - MAX_VIEW_LINES)
      }
      partial = result.partial
      render()
    }
  } catch (error) {
    if (mine !== generation) return
    showNotice(error instanceof Error ? error.message : 'Reading the log failed.')
  }
  if (mine === generation) schedulePoll()
}

async function open(path: string): Promise<void> {
  const problem = source === 'sandbox' ? validateSandboxPath(path) : null
  if (problem !== null) {
    showNotice(problem)
    pathInput.focus()
    return
  }
  stopPolling()
  const mine = ++generation
  showNotice('Loading…', 'info')
  openButton.disabled = true
  try {
    const result = await window.logsApi.open(source, path.trim(), Number(linesSelect.value))
    if (mine !== generation) return
    if (!result.ok) {
      openPath = null
      lines = []
      partial = ''
      showNotice(result.message)
      render()
      return
    }
    openPath = result.path
    pathInput.value = result.path
    lines = result.lines
    partial = result.partial
    size = result.size
    note = result.cutStart ? 'the file is large: only its last part is shown' : ''
    showNotice(null)
    render()
    viewElement.scrollTop = viewElement.scrollHeight
    schedulePoll()
  } catch (error) {
    if (mine === generation) showNotice(error instanceof Error ? error.message : 'Opening the log failed.')
  } finally {
    if (mine === generation) openButton.disabled = false
  }
}

// --- Controls ----------------------------------------------------------------------------------

openButton.addEventListener('click', () => void open(pathInput.value))
pathInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void open(pathInput.value)
})

followBox.addEventListener('change', () => {
  if (followBox.checked) {
    // Catch up at once instead of waiting for the next interval.
    stopPolling()
    if (openPath !== null) void poll(generation)
  } else {
    stopPolling()
  }
})

wrapBox.addEventListener('change', () => viewElement.classList.toggle('wrap', wrapBox.checked))
filterInput.addEventListener('input', render)
linesSelect.addEventListener('change', () => {
  if (openPath !== null) void open(openPath)
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && followBox.checked && openPath !== null && pollTimer === undefined) schedulePoll()
})

/** Copies text with the clipboard API, or with a temporary text area if the page may not use it. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const done = document.execCommand('copy')
    area.remove()
    return done
  }
}

copyButton.addEventListener('click', () => {
  const text = visibleLines().join('\n')
  void copyText(text).then((done) =>
    done ? showNotice(`Copied ${visibleLines().length} lines.`, 'ok') : showNotice('Copying failed.')
  )
})

saveButton.addEventListener('click', () => {
  const text = visibleLines().join('\n') + '\n'
  const name = openPath === null ? 'log.txt' : `${baseName(openPath) || 'log'}.txt`
  saveButton.disabled = true
  void window.logsApi
    .save(text, name)
    .then((result) => {
      if (result.status !== 'cancelled') showNotice(result.message, result.status === 'done' ? 'ok' : 'error')
    })
    .catch((error: unknown) => showNotice(error instanceof Error ? error.message : 'Saving failed.'))
    .finally(() => render())
})

element<HTMLButtonElement>('back').addEventListener('click', () => {
  void window.logsApi.back()
})

// --- Finding logs ------------------------------------------------------------------------------

function describeFound(file: FoundLog): string {
  const when = new Date(file.modified).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  return `${file.path}  (${formatBytes(file.size)}, ${when})`
}

let searched = false

/** The list is filled on first use: the search takes a moment because it runs inside the sandbox. */
async function findLogs(): Promise<void> {
  if (searched) return
  searched = true
  foundSelect.disabled = true
  foundSelect.options[0]!.textContent = 'Searching…'
  const result = await window.logsApi.find(source).catch((error: unknown) => ({
    ok: false as const,
    message: error instanceof Error ? error.message : 'The search failed.'
  }))
  foundSelect.replaceChildren(new Option(result.ok ? `Found ${result.files.length} logs` : 'Search failed', ''))
  if (!result.ok) {
    showNotice(result.message)
    searched = false
  } else {
    for (const file of result.files) {
      const option = new Option(describeFound(file), file.path)
      option.title = file.path
      foundSelect.append(option)
    }
  }
  foundSelect.disabled = false
}

foundSelect.addEventListener('focus', () => void findLogs())
foundSelect.addEventListener('change', () => {
  if (foundSelect.value !== '') {
    pathInput.value = foundSelect.value
    void open(foundSelect.value)
  }
})

// --- "Browse…" picker --------------------------------------------------------------------------

const picker = createFilePicker({
  list: (path) => window.logsApi.list(path),
  context: () => context
})

browseButton.addEventListener('click', () => {
  const value = pathInput.value.trim()
  const valid = validateSandboxPath(value) === null
  // A path to a file starts in its folder; a path ending in "/" is already a folder.
  const start = !valid ? (context?.home ?? '/') : value.endsWith('/') ? value : parentSandboxPath(value)
  void picker.open({
    title: 'Choose a log file',
    kind: 'any',
    start,
    apply: (path) => {
      pathInput.value = path
      void open(path)
    }
  })
})

// --- Source ------------------------------------------------------------------------------------

/**
 * The dialog shows either the logs of one sandbox (opened from the Sandboxes dialog or the Files
 * dialog) or the app's own log (opened from the Application menu). There is no switch: how it was
 * opened decides, and the app's own log has no way back to the Sandboxes dialog.
 */
function useAppLog(): void {
  source = 'app'
  element<HTMLElement>('title').textContent = 'Application log'
  element<HTMLElement>('back').hidden = true
  browseButton.hidden = true
  pathInput.readOnly = true
  pathInput.placeholder = 'Name of a log file of this app'
  foundSelect.setAttribute('aria-label', 'Log files of this app')
  foundSelect.options[0]!.textContent = 'Other files…'
  // The app's own log has a fixed place: open the current file at once.
  pathInput.value = LOG_BASE_NAME + LOG_EXTENSION
  void open(pathInput.value)
}

// --- Start -------------------------------------------------------------------------------------

render()
void window.logsApi.context().then((loaded) => {
  if (loaded === null) {
    showNotice('This dialog was opened without a sandbox.')
    return
  }
  context = loaded
  element<HTMLElement>('sandbox-name').textContent = loaded.sandbox ?? ''
  foundSelect.disabled = false
  if (loaded.initialSource === 'app') {
    useAppLog()
  } else if (loaded.initialPath !== null) {
    pathInput.value = loaded.initialPath
    void open(loaded.initialPath)
  } else {
    pathInput.focus()
  }
})

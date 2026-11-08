import { parentSandboxPath } from '../shared/sandbox-path'
import { validateSandboxPath, type TransferContext, type TransferResult } from '../shared/transfer'
import { setupDialogClose } from './dialog-common'
import { createFilePicker } from './file-picker'

setupDialogClose(() => window.transferApi.close())

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element #${id}`)
  return found as T
}

const noticeElement = element<HTMLElement>('notice')
const destinationInput = element<HTMLInputElement>('destination')
const sourceInput = element<HTMLInputElement>('source')
const uploadFilesButton = element<HTMLButtonElement>('upload-files')
const uploadFolderButton = element<HTMLButtonElement>('upload-folder')
const downloadButton = element<HTMLButtonElement>('download')
const browseDestinationButton = element<HTMLButtonElement>('browse-destination')
const browseSourceButton = element<HTMLButtonElement>('browse-source')
const actionButtons = [
  uploadFilesButton,
  uploadFolderButton,
  downloadButton,
  browseDestinationButton,
  browseSourceButton
]

function showNotice(message: string | null, kind: 'error' | 'ok' | 'info' = 'info'): void {
  if (message === null) {
    noticeElement.hidden = true
    return
  }
  noticeElement.textContent = message
  noticeElement.className = kind === 'info' ? 'notice' : `notice ${kind}`
  noticeElement.hidden = false
}

function setBusy(busy: boolean): void {
  for (const button of actionButtons) button.disabled = busy
}

/** Runs one transfer and reports how it ended. The pickers and confirmations open in the main process. */
async function run(start: () => Promise<TransferResult>): Promise<void> {
  setBusy(true)
  showNotice('Working… the file picker may take a moment to appear.')
  try {
    const result = await start()
    showNotice(
      result.status === 'cancelled' ? null : result.message,
      result.status === 'done' ? 'ok' : 'error'
    )
  } catch (error) {
    showNotice(error instanceof Error ? error.message : 'The copy failed.', 'error')
  } finally {
    setBusy(false)
  }
}

function checked(input: HTMLInputElement): string | null {
  const problem = validateSandboxPath(input.value)
  if (problem !== null) {
    showNotice(problem, 'error')
    input.focus()
    return null
  }
  return input.value
}

uploadFilesButton.addEventListener('click', () => {
  const destination = checked(destinationInput)
  if (destination !== null) void run(() => window.transferApi.uploadFiles(destination))
})

uploadFolderButton.addEventListener('click', () => {
  const destination = checked(destinationInput)
  if (destination !== null) void run(() => window.transferApi.uploadFolder(destination))
})

downloadButton.addEventListener('click', () => {
  const source = checked(sourceInput)
  if (source !== null) void run(() => window.transferApi.download(source))
})

element<HTMLButtonElement>('back').addEventListener('click', () => {
  void window.transferApi.back()
})

// --- "Browse…" picker --------------------------------------------------------------------------

let context: TransferContext | null = null

const picker = createFilePicker({
  list: (path) => window.transferApi.list(path),
  context: () => context
})
const openPicker = picker.open

browseDestinationButton.addEventListener('click', () => {
  const value = destinationInput.value.trim()
  void openPicker({
    title: 'Choose the destination folder',
    kind: 'directories',
    start: validateSandboxPath(value) === null ? value : (context?.home ?? '/'),
    apply: (path) => {
      destinationInput.value = path
    }
  })
})

browseSourceButton.addEventListener('click', () => {
  const value = sourceInput.value.trim()
  const valid = validateSandboxPath(value) === null
  // A path to a file starts in its folder; a path ending in "/" is already a folder.
  const start = !valid ? (context?.home ?? '/') : value.endsWith('/') ? value : parentSandboxPath(value)
  void openPicker({
    title: 'Choose the file or folder to download',
    kind: 'any',
    start,
    apply: (path) => {
      sourceInput.value = path
    }
  })
})

void window.transferApi.context().then((loaded) => {
  if (loaded === null) {
    showNotice('This dialog was opened without a sandbox.', 'error')
    setBusy(true)
    return
  }
  context = loaded
  element<HTMLElement>('sandbox-name').textContent = loaded.sandbox
  const home = loaded.home ?? '~'
  destinationInput.value = home
  sourceInput.value = `${home}/`
  destinationInput.focus()
  destinationInput.select()
})

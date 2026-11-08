import type { TransferResult } from '../shared/transfer'
import { showContextMenu } from './context-menu'
import { setupDialogClose } from './dialog-common'
import { FileBrowser, type BrowserItem, type BrowserState } from './file-browser'

setupDialogClose(() => window.explorerApi.close())

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element #${id}`)
  return found as T
}

const noticeElement = element<HTMLElement>('notice')
const copyButton = element<HTMLButtonElement>('copy-to-host')
const uploadButton = element<HTMLButtonElement>('upload-here')
const newFolderButton = element<HTMLButtonElement>('new-folder')
const renameButton = element<HTMLButtonElement>('rename')
const deleteButton = element<HTMLButtonElement>('delete')
const selectionInfo = element<HTMLElement>('selection-info')

function showNotice(message: string | null, kind: 'error' | 'ok' | 'info' = 'error'): void {
  if (message === null) {
    noticeElement.hidden = true
    return
  }
  noticeElement.textContent = message
  noticeElement.className = kind === 'info' ? 'notice explorer-notice' : `notice explorer-notice ${kind}`
  noticeElement.hidden = false
}

let browser: FileBrowser | null = null
/** True while an operation runs (and while a native dialog of the main process is open). */
let busy = false

function updateToolbar(state: BrowserState): void {
  const count = state.selected.length
  copyButton.disabled = busy || count === 0
  deleteButton.disabled = busy || count === 0
  renameButton.disabled = busy || count !== 1
  uploadButton.disabled = busy
  newFolderButton.disabled = busy
  selectionInfo.textContent = count === 0 ? '' : `${count} selected`
}

function show(result: TransferResult): void {
  showNotice(result.status === 'cancelled' ? null : result.message, result.status === 'done' ? 'ok' : 'error')
}

/** Runs one operation of the main process with the toolbar locked and reports how it ended. */
async function run(start: () => Promise<TransferResult>, waiting?: string): Promise<TransferResult | null> {
  if (busy) return null
  busy = true
  if (browser) updateToolbar(browser.state)
  if (waiting) showNotice(waiting, 'info')
  try {
    const result = await start()
    show(result)
    return result
  } catch (error) {
    showNotice(error instanceof Error ? error.message : 'The operation failed.')
    return null
  } finally {
    busy = false
    if (browser) updateToolbar(browser.state)
  }
}

const PICKER_WAIT = 'Working… the picker may take a moment to appear.'

async function copyToHost(): Promise<void> {
  if (!browser) return
  const paths = browser.state.selected.map((item) => item.path)
  if (paths.length > 0) await run(() => window.explorerApi.copyToHost(paths), PICKER_WAIT)
}

async function upload(kind: 'files' | 'folder'): Promise<void> {
  if (!browser) return
  const folder = browser.state.path
  const result = await run(() => window.explorerApi.uploadHere(folder, kind), PICKER_WAIT)
  if (result?.status === 'done') await browser.refresh()
}

async function remove(items: BrowserItem[]): Promise<void> {
  if (!browser || items.length === 0) return
  const paths = items.map((item) => item.path)
  const result = await run(() => window.explorerApi.remove(paths), 'Waiting for your confirmation…')
  if (result?.status === 'done') await browser.refresh()
}

async function viewAsLog(path: string | null): Promise<void> {
  if (path !== null) await run(() => window.explorerApi.viewAsLog(path))
}

copyButton.addEventListener('click', () => void copyToHost())
uploadButton.addEventListener('click', () => {
  // Files by default; folders from the context menu. A single button keeps the toolbar short.
  void upload('files')
})
newFolderButton.addEventListener('click', () => browser?.startNewFolder())
renameButton.addEventListener('click', () => browser?.startRename())
deleteButton.addEventListener('click', () => void remove(browser?.state.selected ?? []))
element<HTMLButtonElement>('back').addEventListener('click', () => {
  void window.explorerApi.back()
})

void window.explorerApi.context().then(async (context) => {
  if (context === null) {
    showNotice('This dialog was opened without a sandbox.')
    return
  }
  element<HTMLElement>('sandbox-name').textContent = context.sandbox

  browser = new FileBrowser({
    container: element<HTMLElement>('browser'),
    home: context.home,
    mounts: context.mounts,
    list: (path) => window.explorerApi.list(path),
    onChange: updateToolbar,
    // A folder that loads again clears an earlier loading error, but not the result message of an operation.
    onError: (message) => {
      if (message !== null) showNotice(message)
      else if (noticeElement.classList.contains('error')) showNotice(null)
    },
    onRename: async (item, newName) => {
      const result = await run(() => window.explorerApi.rename(item.path, newName))
      return result?.status === 'done'
    },
    onCreateFolder: async (name) => {
      const folder = browser?.state.path ?? '/'
      const result = await run(() => window.explorerApi.createFolder(folder, name))
      return result?.status === 'done'
    },
    onDelete: (items) => void remove(items),
    onContextMenu: (x, y) => {
      const count = browser?.state.selected.length ?? 0
      const only = count === 1 ? browser?.state.selected[0] : undefined
      const onlyFile = only !== undefined && !only.entry.isDirectory ? only.path : null
      showContextMenu(
        [
          { label: 'Copy to host…', enabled: count > 0 && !busy, onClick: () => void copyToHost() },
          { label: 'View as log', enabled: onlyFile !== null && !busy, onClick: () => void viewAsLog(onlyFile) },
          { label: 'Rename', enabled: count === 1 && !busy, onClick: () => browser?.startRename() },
          { label: 'Delete', enabled: count > 0 && !busy, onClick: () => void remove(browser?.state.selected ?? []) },
          { label: 'New folder', enabled: !busy, onClick: () => browser?.startNewFolder() },
          { label: 'Upload files here…', enabled: !busy, onClick: () => void upload('files') },
          { label: 'Upload folder here…', enabled: !busy, onClick: () => void upload('folder') },
          { label: 'Refresh', onClick: () => void browser?.refresh() }
        ],
        x,
        y
      )
    }
  })
  await browser.navigate(context.home ?? '/')
  browser.focusList()
})

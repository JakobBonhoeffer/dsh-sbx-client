import type { ListResult } from '../shared/explorer'
import { FileBrowser, type BrowserState } from './file-browser'

/**
 * The "Browse…" picker: the file browser as a layer over a dialog. The page provides the markup
 * (`#picker` and the elements inside it, see transfer.html) and a read-only `list` function.
 * Escape closes only the picker, not the dialog underneath.
 */

export interface PickerRequest {
  title: string
  /** 'directories' chooses a folder (a selected sub-folder, otherwise the open one); 'any' needs a selected item. */
  kind: 'directories' | 'any'
  /** Where to start: a folder path, or for a file chooser the current value of the field. */
  start: string
  apply: (path: string) => void
}

export interface FilePickerOptions {
  list: (path: string) => Promise<ListResult>
  /** Called when the picker opens; returns what the browser needs, or null when it is not ready. */
  context: () => { home: string | null; mounts: Array<{ sandboxPath: string; readOnly: boolean }> } | null
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element #${id}`)
  return found as T
}

export function createFilePicker(options: FilePickerOptions): { open: (request: PickerRequest) => Promise<void> } {
  const pickerElement = element<HTMLElement>('picker')
  const pickerTitle = element<HTMLElement>('picker-title')
  const pickerNotice = element<HTMLElement>('picker-notice')
  const pickerChoice = element<HTMLElement>('picker-choice')
  const pickerSelect = element<HTMLButtonElement>('picker-select')

  let apply: ((path: string) => void) | null = null
  /** What "Select" would choose right now; null when nothing can be chosen yet. */
  let value: string | null = null

  function close(): void {
    pickerElement.hidden = true
    apply = null
    value = null
    element<HTMLElement>('picker-browser').replaceChildren()
  }

  function updateChoice(state: BrowserState, kind: 'directories' | 'any'): void {
    const chosen = state.selected[0]?.path
    value = chosen ?? (kind === 'directories' ? state.path : null)
    pickerSelect.disabled = value === null
    pickerChoice.textContent = value === null ? 'Click a file or folder to choose it.' : `Chosen: ${value}`
  }

  async function open(request: PickerRequest): Promise<void> {
    const context = options.context()
    if (!context) return
    pickerTitle.textContent = request.title
    pickerNotice.hidden = true
    pickerSelect.disabled = true
    pickerChoice.textContent = ''
    apply = request.apply
    pickerElement.hidden = false

    const browser = new FileBrowser({
      container: element<HTMLElement>('picker-browser'),
      home: context.home,
      mounts: context.mounts,
      list: options.list,
      selectable: request.kind,
      multiple: false,
      onChange: (state) => updateChoice(state, request.kind),
      onError: (message) => {
        pickerNotice.textContent = message ?? ''
        pickerNotice.className = 'notice explorer-notice error'
        pickerNotice.hidden = message === null
      },
      // Double-clicking a file in the file chooser picks it.
      onOpenFile: (item) => {
        if (request.kind === 'any') {
          apply?.(item.path)
          close()
        }
      }
    })

    // Start where the field points to; fall back to the home folder (or the root) if that does not exist.
    const fallback = context.home ?? '/'
    if (!(await browser.navigate(request.start))) await browser.navigate(fallback)
    browser.focusList()
  }

  pickerSelect.addEventListener('click', () => {
    if (value !== null) apply?.(value)
    close()
  })
  element<HTMLButtonElement>('picker-cancel').addEventListener('click', close)

  // Escape closes only the picker, not the whole dialog underneath.
  pickerElement.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      close()
    }
  })

  return { open }
}

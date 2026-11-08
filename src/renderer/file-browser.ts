import type { FileEntry, ListResult } from '../shared/explorer'
import { joinSandboxPath, parentSandboxPath, pathSegments } from '../shared/sandbox-path'

/** An entry together with its full path inside the sandbox. */
export interface BrowserItem {
  path: string
  entry: FileEntry
}

export interface BrowserState {
  /** The folder that is currently shown. */
  path: string
  /** The selected entries of that folder. */
  selected: BrowserItem[]
  entryCount: number
  truncated: boolean
}

export interface FileBrowserOptions {
  container: HTMLElement
  home: string | null
  mounts: ReadonlyArray<{ sandboxPath: string; readOnly: boolean }>
  /** Lists one folder. The browser never talks to the sandbox itself. */
  list: (path: string) => Promise<ListResult>
  /** Called when the folder or the selection changes. */
  onChange?: (state: BrowserState) => void
  /** Called with an error text when a folder cannot be shown, and with null once it works again. */
  onError?: (message: string | null) => void
  /** Called for a right click in the list; the selection has already been adjusted. */
  onContextMenu?: (x: number, y: number) => void
  /** Called for a double click on a file (folders are entered instead). */
  onOpenFile?: (item: BrowserItem) => void
  /**
   * Called when the user confirmed a new name in the list (F2 or the menu). Return true when the
   * item was renamed: the folder is then reloaded and the item stays selected.
   */
  onRename?: (item: BrowserItem, newName: string) => Promise<boolean>
  /** Called when the user confirmed the name of a new folder. Return true when it was created. */
  onCreateFolder?: (name: string) => Promise<boolean>
  /** Called for the Delete key with the current selection. */
  onDelete?: (items: BrowserItem[]) => void
  /** 'any': files and folders can be selected. 'directories': files are shown dimmed and cannot be selected. */
  selectable?: 'any' | 'directories'
  /** Whether several items can be selected at once (Ctrl, Shift, Ctrl+A). Default true; pickers set false. */
  multiple?: boolean
}

interface TreeNode {
  path: string
  li: HTMLElement
  row: HTMLElement
  toggle: HTMLButtonElement
  childrenEl: HTMLElement
  loaded: boolean
  expanded: boolean
  /** True when the folder is known to have no sub-folders (or cannot be read). */
  leaf: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== '') node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function formatDate(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : ''
}

/**
 * A small file explorer for a folder tree that lives somewhere else: a tree on the left, the
 * entries of the current folder on the right, an address bar on top. It only renders what the
 * `list` callback returns, so the same component serves the Files dialog and the "Browse…" picker.
 */
export class FileBrowser {
  private readonly options: FileBrowserOptions
  private readonly selectable: 'any' | 'directories'

  private readonly upButton: HTMLButtonElement
  private readonly address: HTMLElement
  private readonly treeRoot: HTMLElement
  private readonly listEl: HTMLElement
  private readonly statusEl: HTMLElement

  private currentPath = '/'
  private entries: FileEntry[] = []
  private truncated = false
  private readonly selected = new Set<string>()
  private anchor: number | null = null
  private navToken = 0
  private editingAddress = false

  private readonly cache = new Map<string, Extract<ListResult, { ok: true }>>()
  private readonly tree = new Map<string, TreeNode>()

  constructor(options: FileBrowserOptions) {
    this.options = options
    this.selectable = options.selectable ?? 'any'

    const root = el('div', 'fb')

    // Top bar: up, refresh, address
    const bar = el('div', 'fb-bar')
    this.upButton = el('button', 'button icon', '↑')
    this.upButton.type = 'button'
    this.upButton.title = 'Up one folder (Backspace)'
    this.upButton.addEventListener('click', () => void this.navigate(parentSandboxPath(this.currentPath)))
    const refreshButton = el('button', 'button icon', '⟳')
    refreshButton.type = 'button'
    refreshButton.title = 'Refresh (F5)'
    refreshButton.addEventListener('click', () => void this.refresh())
    this.address = el('div', 'fb-address')
    this.address.addEventListener('mousedown', (event) => {
      // A click on the empty part of the bar turns the breadcrumbs into an editable path.
      if (event.target === this.address) {
        event.preventDefault()
        this.startEditingAddress()
      }
    })
    bar.append(this.upButton, refreshButton, this.address)

    // Main area: side (quick access + tree) and content (header + list)
    const main = el('div', 'fb-main')
    const side = el('aside', 'fb-side')
    const quick = el('div', 'fb-quick')
    if (options.home !== null) quick.append(this.quickButton('Home', options.home))
    for (const mount of options.mounts) {
      quick.append(this.quickButton(mount.sandboxPath, mount.sandboxPath, mount.readOnly ? 'read-only' : undefined))
    }
    this.treeRoot = el('ul', 'fb-tree')
    side.append(quick, this.treeRoot)

    const content = el('section', 'fb-content')
    const head = el('div', 'fb-head')
    head.append(el('span', '', 'Name'), el('span', 'fb-num', 'Size'), el('span', '', 'Modified'))
    this.listEl = el('div', 'fb-list')
    this.listEl.tabIndex = 0
    this.listEl.setAttribute('role', 'listbox')
    this.listEl.setAttribute('aria-multiselectable', String(this.allowsMultiple))
    content.append(head, this.listEl)
    main.append(side, content)

    this.statusEl = el('div', 'fb-status')
    root.append(bar, main, this.statusEl)
    options.container.replaceChildren(root)

    this.wireList()
    this.addRootNode()
    this.renderAddress()
  }

  get state(): BrowserState {
    return {
      path: this.currentPath,
      selected: this.selectedItems(),
      entryCount: this.entries.length,
      truncated: this.truncated
    }
  }

  focusList(): void {
    this.listEl.focus()
  }

  /** Edits the name of the selected item in place. Needs exactly one selected item. */
  startRename(): void {
    const [item] = this.selectedItems()
    if (!item || this.selected.size !== 1 || !this.options.onRename) return
    const index = this.entries.findIndex((entry) => entry.name === item.entry.name)
    const label = this.listEl.querySelector(`[data-index="${index}"] .fb-name span:last-child`)
    if (!label) return

    const input = this.createNameInput(item.entry.name)
    label.replaceWith(input)
    // Select the name without its extension, like a file explorer does.
    const dot = item.entry.isDirectory ? -1 : item.entry.name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : item.entry.name.length)

    this.finishNameInput(
      input,
      () => this.renderList(),
      async (value) => {
        if (value === item.entry.name) return false
        return (await this.options.onRename?.(item, value)) === true
      },
      (value) => void this.reloadAndSelect(value),
      () => this.renderList()
    )
  }

  /** Adds an editable "New folder" row at the top of the list. */
  startNewFolder(): void {
    if (!this.options.onCreateFolder) return
    const row = el('div', 'fb-row new')
    const name = el('span', 'fb-name')
    const input = this.createNameInput('New folder')
    name.append(el('span', 'fb-icon', '📁'), input)
    row.append(name, el('span', 'fb-num'), el('span', 'fb-date'))

    this.listEl.querySelector('.fb-empty')?.remove()
    this.listEl.prepend(row)
    this.listEl.scrollTop = 0
    input.select()

    this.finishNameInput(
      input,
      () => row.remove(),
      async (value) => (await this.options.onCreateFolder?.(value)) === true,
      (value) => void this.reloadAndSelect(value),
      () => row.remove()
    )
  }

  private createNameInput(value: string): HTMLInputElement {
    const input = el('input', 'input fb-rename')
    input.type = 'text'
    input.spellcheck = false
    input.value = value
    // Clicks and keys inside the field must not reach the list (selection, shortcuts).
    for (const type of ['click', 'dblclick', 'mousedown', 'keydown'] as const) {
      input.addEventListener(type, (event) => event.stopPropagation())
    }
    queueMicrotask(() => input.focus())
    return input
  }

  /**
   * Wires Enter (commit), Escape and leaving the field (cancel) for an in-place name field.
   * `commit` returns true when the change was made.
   */
  private finishNameInput(
    input: HTMLInputElement,
    restore: () => void,
    commit: (value: string) => Promise<boolean>,
    onSuccess: (value: string) => void,
    onCancel: () => void
  ): void {
    let done = false
    const cancel = (): void => {
      if (done) return
      done = true
      onCancel()
      this.focusList()
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (done) return
        done = true
        input.disabled = true
        void commit(input.value).then((ok) => {
          if (ok) onSuccess(input.value)
          else restore()
          this.focusList()
        })
      }
    })
    input.addEventListener('blur', cancel)
  }

  /** Reloads the current folder from the sandbox and selects the item with this name. */
  private async reloadAndSelect(name: string): Promise<void> {
    this.cache.clear()
    await this.navigate(this.currentPath)
    const node = this.tree.get(this.currentPath)
    if (node?.expanded) void this.loadChildren(node)
    const index = this.entries.findIndex((entry) => entry.name === name)
    if (index >= 0) {
      this.selected.add(name)
      this.anchor = index
      this.refreshSelection()
      this.listEl.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }

  /**
   * Shows a folder. If it cannot be read nothing changes and the error goes to `onError`.
   * Returns true when the folder is now shown, false if it failed or a newer navigation replaced this one.
   */
  async navigate(path: string): Promise<boolean> {
    const token = ++this.navToken
    this.listEl.classList.add('loading')
    const result = await this.fetchFolder(path)
    if (token !== this.navToken) return false
    this.listEl.classList.remove('loading')

    if (!result.ok) {
      this.options.onError?.(result.message)
      return false
    }
    this.options.onError?.(null)

    this.currentPath = result.path
    this.entries = result.entries
    this.truncated = result.truncated
    this.selected.clear()
    this.anchor = null
    this.renderList()
    this.renderAddress()
    this.markCurrentInTree()
    void this.revealInTree(result.path)
    this.emit()
    return true
  }

  /** Reloads the current folder and every opened tree folder from the sandbox. */
  async refresh(): Promise<void> {
    this.cache.clear()
    const opened = [...this.tree.values()].filter((node) => node.expanded)
    for (const node of this.tree.values()) node.loaded = false
    await this.navigate(this.currentPath)
    for (const node of opened) await this.loadChildren(node)
  }

  // --- Data ---------------------------------------------------------------------------------

  private async fetchFolder(path: string): Promise<ListResult> {
    const cached = this.cache.get(path)
    if (cached) return cached
    const result = await this.options.list(path)
    if (result.ok) {
      this.cache.set(result.path, result)
      this.cache.set(path, result)
    }
    return result
  }

  private selectedItems(): BrowserItem[] {
    return this.entries
      .filter((entry) => this.selected.has(entry.name))
      .map((entry) => ({ path: joinSandboxPath(this.currentPath, entry.name), entry }))
  }

  private emit(): void {
    this.updateStatus()
    this.options.onChange?.(this.state)
  }

  /** Several items can be selected at once (not in pickers that need exactly one). */
  private get allowsMultiple(): boolean {
    return this.selectable === 'any' && this.options.multiple !== false
  }

  private isSelectable(entry: FileEntry): boolean {
    return this.selectable === 'any' || entry.isDirectory
  }

  // --- List ---------------------------------------------------------------------------------

  private wireList(): void {
    const indexOf = (target: EventTarget | null): number | null => {
      const row = target instanceof Element ? target.closest<HTMLElement>('.fb-row') : null
      return row?.dataset['index'] === undefined ? null : Number(row.dataset['index'])
    }

    this.listEl.addEventListener('click', (event) => {
      const index = indexOf(event.target)
      if (index === null) {
        // Clicking the empty area clears the selection.
        this.selected.clear()
        this.anchor = null
        this.refreshSelection()
        return
      }
      this.clickRow(index, event)
    })

    this.listEl.addEventListener('dblclick', (event) => {
      const index = indexOf(event.target)
      const entry = index === null ? undefined : this.entries[index]
      if (!entry) return
      const path = joinSandboxPath(this.currentPath, entry.name)
      if (entry.isDirectory) void this.navigate(path)
      else this.options.onOpenFile?.({ path, entry })
    })

    this.listEl.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const index = indexOf(event.target)
      const entry = index === null ? undefined : this.entries[index]
      if (entry && !this.selected.has(entry.name) && this.isSelectable(entry)) {
        this.selected.clear()
        this.selected.add(entry.name)
        this.anchor = index
        this.refreshSelection()
      } else if (!entry) {
        this.selected.clear()
        this.refreshSelection()
      }
      this.options.onContextMenu?.(event.clientX, event.clientY)
    })

    this.listEl.addEventListener('keydown', (event) => this.onKey(event))
  }

  private clickRow(index: number, event: MouseEvent): void {
    const entry = this.entries[index]
    if (!entry || !this.isSelectable(entry)) return
    const multi = this.allowsMultiple

    if (multi && event.shiftKey && this.anchor !== null) {
      const [from, to] = this.anchor < index ? [this.anchor, index] : [index, this.anchor]
      if (!event.ctrlKey) this.selected.clear()
      for (let i = from; i <= to; i++) {
        const item = this.entries[i]
        if (item && this.isSelectable(item)) this.selected.add(item.name)
      }
    } else if (multi && (event.ctrlKey || event.metaKey)) {
      if (this.selected.has(entry.name)) this.selected.delete(entry.name)
      else this.selected.add(entry.name)
      this.anchor = index
    } else {
      this.selected.clear()
      this.selected.add(entry.name)
      this.anchor = index
    }
    this.refreshSelection()
  }

  private onKey(event: KeyboardEvent): void {
    const focusIndex = this.anchor ?? -1
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        let next = focusIndex + step
        while (next >= 0 && next < this.entries.length) {
          const candidate = this.entries[next]
          if (candidate && this.isSelectable(candidate)) break
          next += step
        }
        const target = this.entries[next]
        if (!target) return
        this.selected.clear()
        this.selected.add(target.name)
        this.anchor = next
        this.refreshSelection()
        this.listEl.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
        return
      }
      case 'Enter': {
        const [only] = this.selectedItems()
        if (only?.entry.isDirectory && this.selected.size === 1) void this.navigate(only.path)
        return
      }
      case 'Backspace':
        event.preventDefault()
        void this.navigate(parentSandboxPath(this.currentPath))
        return
      case 'F5':
        event.preventDefault()
        void this.refresh()
        return
      case 'F2':
        event.preventDefault()
        this.startRename()
        return
      case 'Delete': {
        const items = this.selectedItems()
        if (items.length > 0) {
          event.preventDefault()
          this.options.onDelete?.(items)
        }
        return
      }
      case 'a':
        if (event.ctrlKey && this.allowsMultiple) {
          event.preventDefault()
          this.selected.clear()
          for (const entry of this.entries) this.selected.add(entry.name)
          this.refreshSelection()
        }
        return
    }
  }

  private renderList(): void {
    if (this.entries.length === 0) {
      this.listEl.replaceChildren(el('div', 'fb-empty', 'This folder is empty.'))
      return
    }
    const rows = this.entries.map((entry, index) => {
      const row = el('div', 'fb-row')
      row.dataset['index'] = String(index)
      row.setAttribute('role', 'option')
      if (!this.isSelectable(entry)) row.classList.add('disabled')

      const name = el('span', 'fb-name')
      name.append(el('span', 'fb-icon', entry.isDirectory ? '📁' : entry.isSymlink ? '🔗' : '📄'), el('span', '', entry.name))
      name.title = entry.name
      row.append(
        name,
        el('span', 'fb-num', entry.isDirectory ? '' : formatSize(entry.size)),
        el('span', 'fb-date', formatDate(entry.modified))
      )
      return row
    })
    this.listEl.replaceChildren(...rows)
  }

  private refreshSelection(): void {
    for (const row of this.listEl.querySelectorAll<HTMLElement>('.fb-row')) {
      const entry = this.entries[Number(row.dataset['index'])]
      const isSelected = entry !== undefined && this.selected.has(entry.name)
      row.classList.toggle('selected', isSelected)
      row.setAttribute('aria-selected', String(isSelected))
    }
    this.emit()
  }

  private updateStatus(): void {
    const parts = [`${this.entries.length} item${this.entries.length === 1 ? '' : 's'}`]
    if (this.selected.size > 0) parts.push(`${this.selected.size} selected`)
    if (this.truncated) parts.push('only the first entries are shown')
    this.statusEl.textContent = parts.join(' · ')
  }

  // --- Address bar --------------------------------------------------------------------------

  private renderAddress(): void {
    this.upButton.disabled = this.currentPath === '/'
    if (this.editingAddress) return

    const parts: HTMLElement[] = []
    for (const [index, segment] of pathSegments(this.currentPath).entries()) {
      if (index > 0) parts.push(el('span', 'fb-sep', '›'))
      const crumb = el('button', 'fb-crumb', segment.name)
      crumb.type = 'button'
      crumb.addEventListener('click', () => void this.navigate(segment.path))
      parts.push(crumb)
    }
    this.address.replaceChildren(...parts)
  }

  private startEditingAddress(): void {
    this.editingAddress = true
    const input = el('input', 'input fb-address-input')
    input.type = 'text'
    input.spellcheck = false
    input.value = this.currentPath
    const finish = (go: boolean): void => {
      if (!this.editingAddress) return
      this.editingAddress = false
      const value = input.value.trim()
      this.renderAddress()
      if (go && value !== '') void this.navigate(value)
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true)
      else if (event.key === 'Escape') {
        event.stopPropagation()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(false))
    this.address.replaceChildren(input)
    input.focus()
    input.select()
  }

  // --- Tree and quick access ----------------------------------------------------------------

  private quickButton(label: string, path: string, note?: string): HTMLButtonElement {
    const button = el('button', 'fb-quick-item')
    button.type = 'button'
    button.title = path
    button.append(el('span', '', label))
    if (note) button.append(el('span', 'hint', note))
    button.addEventListener('click', () => void this.navigate(path))
    return button
  }

  private addRootNode(): void {
    const node = this.createNode('/', '/ (file system)', this.treeRoot)
    void this.setExpanded(node, true)
  }

  private createNode(path: string, label: string, parent: HTMLElement): TreeNode {
    const li = el('li', 'fb-node')
    const row = el('div', 'fb-node-row')
    const toggle = el('button', 'fb-toggle', '▸')
    toggle.type = 'button'
    toggle.tabIndex = -1
    const name = el('button', 'fb-node-label', label)
    name.type = 'button'
    name.title = path
    const childrenEl = el('ul', 'fb-tree fb-children')
    childrenEl.hidden = true
    row.append(toggle, name)
    li.append(row, childrenEl)
    parent.append(li)

    const node: TreeNode = { path, li, row, toggle, childrenEl, loaded: false, expanded: false, leaf: false }
    this.tree.set(path, node)
    toggle.addEventListener('click', () => void this.setExpanded(node, !node.expanded))
    name.addEventListener('click', () => void this.navigate(path))
    name.addEventListener('dblclick', () => void this.setExpanded(node, !node.expanded))
    return node
  }

  private async setExpanded(node: TreeNode, expanded: boolean): Promise<void> {
    if (expanded && !node.loaded) await this.loadChildren(node)
    if (expanded && node.leaf) return
    node.expanded = expanded
    node.childrenEl.hidden = !expanded
    node.toggle.textContent = expanded ? '▾' : '▸'
  }

  /** Fills a tree node with its sub-folders. */
  private async loadChildren(node: TreeNode): Promise<void> {
    const result = await this.fetchFolder(node.path)
    node.loaded = true
    node.childrenEl.replaceChildren()
    for (const [path, child] of [...this.tree]) {
      if (path.startsWith(node.path === '/' ? '/' : `${node.path}/`) && path !== node.path && child !== node) {
        this.tree.delete(path)
      }
    }

    const folders = result.ok ? result.entries.filter((entry) => entry.isDirectory) : []
    node.leaf = folders.length === 0
    node.toggle.classList.toggle('leaf', node.leaf)
    node.toggle.title = result.ok ? '' : result.message
    for (const folder of folders) {
      this.createNode(joinSandboxPath(node.path, folder.name), folder.name, node.childrenEl)
    }
    if (node.expanded) node.childrenEl.hidden = node.leaf
    this.markCurrentInTree()
  }

  /** Opens the tree down to `path` so the current folder is visible in it. */
  private async revealInTree(path: string): Promise<void> {
    const segments = pathSegments(path)
    for (const segment of segments) {
      if (segment.path === path) break
      const node = this.tree.get(segment.path)
      if (!node) return
      await this.setExpanded(node, true)
    }
    this.markCurrentInTree()
  }

  private markCurrentInTree(): void {
    for (const node of this.tree.values()) node.row.classList.toggle('current', node.path === this.currentPath)
  }
}

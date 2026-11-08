export interface MenuItem {
  label: string
  /** Disabled items are shown dimmed and do nothing. */
  enabled?: boolean
  onClick: () => void
}

let current: HTMLElement | null = null

export function closeContextMenu(): void {
  current?.remove()
  current = null
}

/**
 * Shows a small context menu at the given position (inside the page, not a native menu).
 * It closes on a click anywhere else, on Escape and when the page loses focus.
 */
export function showContextMenu(items: readonly MenuItem[], x: number, y: number): void {
  closeContextMenu()

  const menu = document.createElement('div')
  menu.className = 'context-menu'
  menu.setAttribute('role', 'menu')

  for (const item of items) {
    const entry = document.createElement('button')
    entry.type = 'button'
    entry.className = 'context-item'
    entry.setAttribute('role', 'menuitem')
    entry.textContent = item.label
    entry.disabled = item.enabled === false
    entry.addEventListener('click', () => {
      closeContextMenu()
      item.onClick()
    })
    menu.append(entry)
  }

  document.body.append(menu)
  // Keep the menu inside the page: flip it to the other side of the cursor when it would overflow.
  const { width, height } = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - width - 4))}px`
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - height - 4))}px`
  current = menu
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}

// One set of global listeners closes whichever menu is open.
document.addEventListener('mousedown', (event) => {
  if (current && event.target instanceof Node && !current.contains(event.target)) closeContextMenu()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && current) {
    event.stopPropagation()
    closeContextMenu()
  }
}, true)
window.addEventListener('blur', closeContextMenu)

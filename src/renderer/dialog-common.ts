/**
 * Wires the ways to close a dialog: the close button and the Escape key. `close` asks the main
 * process to remove the dialog view.
 */
export function setupDialogClose(close: () => Promise<void>): void {
  document.getElementById('close')?.addEventListener('click', () => {
    void close()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      void close()
    }
  })
}

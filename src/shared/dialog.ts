/** Channels shared by every in-app dialog (Sandboxes, Settings). */
export const DIALOG_IPC = {
  /** Asks the main process to close the dialog the call comes from. */
  close: 'dialog:close'
} as const

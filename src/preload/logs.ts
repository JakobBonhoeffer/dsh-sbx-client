import { contextBridge, ipcRenderer } from 'electron'
import { DIALOG_IPC } from '../shared/dialog'
import { LOGS_IPC, type LogsApi } from '../shared/logs'

const api: LogsApi = {
  context: () => ipcRenderer.invoke(LOGS_IPC.context),
  find: (source) => ipcRenderer.invoke(LOGS_IPC.find, source),
  open: (source, path, lines) => ipcRenderer.invoke(LOGS_IPC.open, source, path, lines),
  poll: () => ipcRenderer.invoke(LOGS_IPC.poll),
  list: (path) => ipcRenderer.invoke(LOGS_IPC.list, path),
  save: (text, suggestedName) => ipcRenderer.invoke(LOGS_IPC.save, text, suggestedName),
  back: () => ipcRenderer.invoke(LOGS_IPC.back),
  close: () => ipcRenderer.invoke(DIALOG_IPC.close)
}

contextBridge.exposeInMainWorld('logsApi', api)

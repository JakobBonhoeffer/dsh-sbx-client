import { contextBridge, ipcRenderer } from 'electron'
import { DIALOG_IPC } from '../shared/dialog'
import { SANDBOX_IPC, type SandboxApi } from '../shared/sandbox'

const api: SandboxApi = {
  list: () => ipcRenderer.invoke(SANDBOX_IPC.list),
  connect: (name, hostPort) => ipcRenderer.invoke(SANDBOX_IPC.connect, name, hostPort),
  connectWithLogin: (name, hostPort) => ipcRenderer.invoke(SANDBOX_IPC.connectWithLogin, name, hostPort),
  start: (name) => ipcRenderer.invoke(SANDBOX_IPC.start, name),
  stop: (name) => ipcRenderer.invoke(SANDBOX_IPC.stop, name),
  openTransfer: (name) => ipcRenderer.invoke(SANDBOX_IPC.openTransfer, name),
  openExplorer: (name) => ipcRenderer.invoke(SANDBOX_IPC.openExplorer, name),
  openLogs: (name) => ipcRenderer.invoke(SANDBOX_IPC.openLogs, name),
  openTemplates: (name) => ipcRenderer.invoke(SANDBOX_IPC.openTemplates, name),
  openMount: (name, hostPath) => ipcRenderer.invoke(SANDBOX_IPC.openMount, name, hostPath),
  close: () => ipcRenderer.invoke(DIALOG_IPC.close)
}

contextBridge.exposeInMainWorld('sandboxApi', api)

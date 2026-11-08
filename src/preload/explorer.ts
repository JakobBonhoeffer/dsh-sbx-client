import { contextBridge, ipcRenderer } from 'electron'
import { DIALOG_IPC } from '../shared/dialog'
import { EXPLORER_IPC, type ExplorerApi } from '../shared/explorer'

const api: ExplorerApi = {
  context: () => ipcRenderer.invoke(EXPLORER_IPC.context),
  list: (path) => ipcRenderer.invoke(EXPLORER_IPC.list, path),
  copyToHost: (paths) => ipcRenderer.invoke(EXPLORER_IPC.copyToHost, paths),
  uploadHere: (destination, kind) => ipcRenderer.invoke(EXPLORER_IPC.uploadHere, destination, kind),
  createFolder: (parent, name) => ipcRenderer.invoke(EXPLORER_IPC.createFolder, parent, name),
  rename: (path, newName) => ipcRenderer.invoke(EXPLORER_IPC.rename, path, newName),
  remove: (paths) => ipcRenderer.invoke(EXPLORER_IPC.remove, paths),
  viewAsLog: (path) => ipcRenderer.invoke(EXPLORER_IPC.viewAsLog, path),
  back: () => ipcRenderer.invoke(EXPLORER_IPC.back),
  close: () => ipcRenderer.invoke(DIALOG_IPC.close)
}

contextBridge.exposeInMainWorld('explorerApi', api)

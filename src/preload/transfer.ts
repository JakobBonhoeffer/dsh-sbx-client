import { contextBridge, ipcRenderer } from 'electron'
import { DIALOG_IPC } from '../shared/dialog'
import { TRANSFER_IPC, type TransferApi } from '../shared/transfer'

const api: TransferApi = {
  context: () => ipcRenderer.invoke(TRANSFER_IPC.context),
  uploadFiles: (destination) => ipcRenderer.invoke(TRANSFER_IPC.uploadFiles, destination),
  uploadFolder: (destination) => ipcRenderer.invoke(TRANSFER_IPC.uploadFolder, destination),
  download: (source) => ipcRenderer.invoke(TRANSFER_IPC.download, source),
  list: (path) => ipcRenderer.invoke(TRANSFER_IPC.list, path),
  back: () => ipcRenderer.invoke(TRANSFER_IPC.back),
  close: () => ipcRenderer.invoke(DIALOG_IPC.close)
}

contextBridge.exposeInMainWorld('transferApi', api)

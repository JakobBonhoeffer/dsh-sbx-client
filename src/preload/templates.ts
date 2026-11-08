import { contextBridge, ipcRenderer } from 'electron'
import { DIALOG_IPC } from '../shared/dialog'
import { TEMPLATES_IPC, type TemplatesApi } from '../shared/templates'

const api: TemplatesApi = {
  context: () => ipcRenderer.invoke(TEMPLATES_IPC.context),
  list: () => ipcRenderer.invoke(TEMPLATES_IPC.list),
  save: (tag, exportFile) => ipcRenderer.invoke(TEMPLATES_IPC.save, tag, exportFile),
  load: () => ipcRenderer.invoke(TEMPLATES_IPC.load),
  remove: (id) => ipcRenderer.invoke(TEMPLATES_IPC.remove, id),
  back: () => ipcRenderer.invoke(TEMPLATES_IPC.back),
  close: () => ipcRenderer.invoke(DIALOG_IPC.close)
}

contextBridge.exposeInMainWorld('templatesApi', api)

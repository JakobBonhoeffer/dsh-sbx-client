import { contextBridge, ipcRenderer } from 'electron'
import { DIALOG_IPC } from '../shared/dialog'
import { SETTINGS_IPC, type SettingsApi } from '../shared/settings'

const api: SettingsApi = {
  get: () => ipcRenderer.invoke(SETTINGS_IPC.get),
  save: (settings) => ipcRenderer.invoke(SETTINGS_IPC.save, settings),
  testSbx: (sbxPath) => ipcRenderer.invoke(SETTINGS_IPC.testSbx, sbxPath),
  about: () => ipcRenderer.invoke(SETTINGS_IPC.about),
  logInfo: () => ipcRenderer.invoke(SETTINGS_IPC.logInfo),
  openLogFolder: () => ipcRenderer.invoke(SETTINGS_IPC.openLogFolder),
  close: () => ipcRenderer.invoke(DIALOG_IPC.close)
}

contextBridge.exposeInMainWorld('settingsApi', api)

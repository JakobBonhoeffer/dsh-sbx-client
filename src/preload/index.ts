import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ConnectionState, type SbxClientApi } from '../shared/ipc'

// Narrow, explicit bridge: the renderer never receives `ipcRenderer` itself.
const api: SbxClientApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  connect: (url) => ipcRenderer.invoke(IPC.connect, url),
  disconnect: (options) => ipcRenderer.invoke(IPC.disconnect, options),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ConnectionState): void => listener(state)
    ipcRenderer.on(IPC.state, handler)
    return () => {
      ipcRenderer.removeListener(IPC.state, handler)
    }
  },
  openSandboxes: () => ipcRenderer.invoke(IPC.openSandboxes),
  openSettings: () => ipcRenderer.invoke(IPC.openSettings),
  openMenu: (menu, x, y) => ipcRenderer.invoke(IPC.openMenu, menu, x, y)
}

contextBridge.exposeInMainWorld('sbxClient', api)

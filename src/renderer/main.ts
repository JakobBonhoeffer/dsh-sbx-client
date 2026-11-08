import { isMenuKey, type ConnectionState } from '../shared/ipc'

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element #${id}`)
  return found as T
}

const form = element<HTMLFormElement>('toolbar')
const urlInput = element<HTMLInputElement>('url')
const primaryButton = element<HTMLButtonElement>('primary')
const signOutButton = element<HTMLButtonElement>('sign-out')
const panel = element<HTMLElement>('panel')
const panelTitle = element<HTMLElement>('panel-title')
const panelText = element<HTMLElement>('panel-text')

let current: ConnectionState = { status: 'disconnected', url: '', message: null }

function render(state: ConnectionState): void {
  const previous = current
  current = state

  const connected = state.status === 'connected'
  const busy = state.status === 'connecting'

  // Do not overwrite what the user is typing; only sync when the host reports a new address.
  if (state.url !== previous.url || previous.status === 'connected' || connected) {
    urlInput.value = state.url
  }
  urlInput.readOnly = connected || busy
  // While connecting the button cancels the attempt (a host that is still starting can take a while).
  primaryButton.textContent = connected ? 'Disconnect' : busy ? 'Cancel' : 'Connect'
  signOutButton.hidden = !connected

  panel.hidden = connected
  panel.dataset['status'] = state.status

  switch (state.status) {
    case 'disconnected':
      panelTitle.textContent = 'Not connected'
      panelText.textContent = 'Enter the address of a DSH web UI and press Connect.'
      break
    case 'connecting':
      panelTitle.textContent = 'Connecting…'
      panelText.textContent = state.message === null ? state.url : `${state.message} ${state.url}`
      break
    case 'error':
      panelTitle.textContent = 'Connection failed'
      panelText.textContent = state.message ?? 'Unknown error.'
      break
    case 'connected':
      break
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (current.status === 'connected' || current.status === 'connecting') {
    void window.sbxClient.disconnect({ signOut: false })
  } else {
    void window.sbxClient.connect(urlInput.value)
  }
})

signOutButton.addEventListener('click', () => {
  void window.sbxClient.disconnect({ signOut: true })
})

// Title bar menus: the main process opens the native popup just below the clicked button.
for (const button of document.querySelectorAll<HTMLButtonElement>('.menu-button')) {
  button.addEventListener('click', () => {
    const menu = button.dataset['menu']
    if (!isMenuKey(menu)) return
    const box = button.getBoundingClientRect()
    void window.sbxClient.openMenu(menu, box.left, box.bottom)
  })
}

element<HTMLButtonElement>('open-sandboxes').addEventListener('click', () => {
  void window.sbxClient.openSandboxes()
})

element<HTMLButtonElement>('open-settings').addEventListener('click', () => {
  void window.sbxClient.openSettings()
})

window.sbxClient.onState(render)
void window.sbxClient.getState().then((state) => {
  render(state)
  urlInput.focus()
  urlInput.select()
})

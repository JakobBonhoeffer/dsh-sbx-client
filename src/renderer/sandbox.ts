import type { SandboxInfo } from '../shared/sandbox'
import { setupDialogClose } from './dialog-common'

setupDialogClose(() => window.sandboxApi.close())

/** How often the list refreshes while the dialog is open. */
const REFRESH_INTERVAL_MS = 4000

/** How long the "Confirm stop" state of the Stop button stays armed. */
const CONFIRM_STOP_MS = 4000

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element #${id}`)
  return found as T
}

const listElement = element<HTMLElement>('list')
const noticeElement = element<HTMLElement>('notice')
const refreshButton = element<HTMLButtonElement>('refresh')

let sandboxes: SandboxInfo[] = []
/** True when a login command is configured in the Settings: then each port also gets a "Login" button. */
let loginAvailable = false
let loading = false

/** Sandboxes with a start or stop in progress. Their buttons are disabled. */
const busy = new Map<string, 'starting' | 'stopping'>()

/** Name of the sandbox whose Stop button was clicked once and now waits for confirmation. */
let confirmStopFor: string | null = null
let confirmTimer: number | undefined

/** Where the visible notice came from: a failed list refresh clears itself, an action error does not. */
let noticeSource: 'list' | 'action' | null = null

/** Builds an element with text. Content is always assigned as text, never as HTML. */
function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function showNotice(message: string | null, source: 'list' | 'action' = 'action'): void {
  if (message === null) {
    noticeElement.hidden = true
    noticeSource = null
    return
  }
  noticeElement.textContent = message
  noticeElement.className = 'notice error'
  noticeElement.hidden = false
  noticeSource = source
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = create('button', className, label)
  node.type = 'button'
  node.addEventListener('click', onClick)
  return node
}

function disarmStopConfirmation(): void {
  window.clearTimeout(confirmTimer)
  confirmStopFor = null
}

async function runAction(name: string, kind: 'starting' | 'stopping'): Promise<void> {
  busy.set(name, kind)
  showNotice(null)
  render()
  try {
    const result = kind === 'starting' ? await window.sandboxApi.start(name) : await window.sandboxApi.stop(name)
    if (!result.ok) showNotice(result.message)
  } finally {
    busy.delete(name)
    await refresh()
  }
}

function actionButton(sandbox: SandboxInfo): HTMLButtonElement {
  const inProgress = busy.get(sandbox.name)
  if (inProgress) {
    const pending = create('button', 'button', inProgress === 'starting' ? 'Starting…' : 'Stopping…')
    pending.type = 'button'
    pending.disabled = true
    return pending
  }

  if (!sandbox.running) {
    return button('Start', 'button primary', () => void runAction(sandbox.name, 'starting'))
  }

  // Stopping ends everything running inside the sandbox, so it needs a second click.
  if (confirmStopFor === sandbox.name) {
    return button('Confirm stop', 'button danger', () => {
      disarmStopConfirmation()
      void runAction(sandbox.name, 'stopping')
    })
  }
  return button('Stop', 'button', () => {
    disarmStopConfirmation()
    confirmStopFor = sandbox.name
    confirmTimer = window.setTimeout(() => {
      confirmStopFor = null
      render()
    }, CONFIRM_STOP_MS)
    render()
  })
}

function renderSandbox(sandbox: SandboxInfo): HTMLElement {
  const card = create('article', 'card')

  const head = create('div', 'card-head')
  head.append(create('span', 'card-title', sandbox.name))
  if (sandbox.agent !== '') head.append(create('span', 'card-meta', sandbox.agent))
  head.append(create('span', sandbox.running ? 'badge running' : 'badge', sandbox.status))
  head.append(create('span', 'spacer'))
  if (sandbox.running && !busy.has(sandbox.name)) {
    const browse = button('Files…', 'button', () => {
      void window.sandboxApi.openExplorer(sandbox.name).then((result) => {
        if (!result.ok) showNotice(result.message)
      })
    })
    browse.title = 'Browse the files of this sandbox'
    head.append(browse)

    const logs = button('Logs…', 'button', () => {
      void window.sandboxApi.openLogs(sandbox.name).then((result) => {
        if (!result.ok) showNotice(result.message)
      })
    })
    logs.title = 'Read the log files of this sandbox'
    head.append(logs)

    const files = button('Copy files…', 'button', () => {
      void window.sandboxApi.openTransfer(sandbox.name).then((result) => {
        if (!result.ok) showNotice(result.message)
      })
    })
    files.title = 'Upload files to this sandbox or download files from it'
    head.append(files)
  }
  // Templates work for a stopped sandbox as well (it is the snapshot that matters).
  if (!busy.has(sandbox.name)) {
    const templates = button('Templates…', 'button', () => {
      void window.sandboxApi.openTemplates(sandbox.name).then((result) => {
        if (!result.ok) showNotice(result.message)
      })
    })
    templates.title = 'Save this sandbox as a template, and manage templates'
    head.append(templates)
  }
  head.append(actionButton(sandbox))
  card.append(head)

  const rows = create('div', 'card-rows')
  if (!sandbox.running) {
    rows.append(create('p', 'hint', 'Not running. Start it to use its published ports.'))
  } else if (sandbox.ports.length === 0) {
    rows.append(
      create('p', 'hint', `No published ports. Publish one with: sbx ports ${sandbox.name} --publish HOST:PORT`)
    )
  } else {
    for (const port of sandbox.ports) {
      const row = create('div', 'row')
      row.append(create('code', '', `127.0.0.1:${port.hostPort} → ${port.sandboxPort}`))

      const buttons = create('div', 'row-actions')
      if (loginAvailable) {
        const login = button('Login', 'button', () => {
          login.disabled = true
          showNotice(null)
          void window.sandboxApi
            .connectWithLogin(sandbox.name, port.hostPort)
            .then((result) => {
              if (!result.ok) showNotice(result.message)
            })
            .finally(() => {
              login.disabled = false
            })
        })
        login.title = 'Run the login command from the Settings in the sandbox and connect with the token it prints'
        login.disabled = busy.has(sandbox.name)
        buttons.append(login)
      }

      const connect = button('Connect', 'button primary', () => {
        connect.disabled = true
        void window.sandboxApi
          .connect(sandbox.name, port.hostPort)
          .then((result) => {
            if (!result.ok) showNotice(result.message)
          })
          .finally(() => {
            connect.disabled = false
          })
      })
      connect.disabled = busy.has(sandbox.name)
      buttons.append(connect)
      row.append(buttons)
      rows.append(row)
    }
  }
  card.append(rows)

  if (sandbox.mounts.length > 0) {
    const mounts = create('div', 'card-rows')
    mounts.append(create('p', 'subheading', 'Shared folders'))
    for (const mount of sandbox.mounts) {
      const row = create('div', 'row')

      const paths = create('div', 'mount-paths')
      paths.append(create('code', '', mount.hostPath))
      const target = create('span', 'hint', `→ ${mount.sandboxPath}`)
      paths.append(target)
      if (mount.readOnly) paths.append(create('span', 'badge', 'read-only'))
      row.append(paths)

      const open = button('Open', 'button', () => {
        open.disabled = true
        void window.sandboxApi
          .openMount(sandbox.name, mount.hostPath)
          .then((result) => {
            if (!result.ok) showNotice(result.message)
          })
          .finally(() => {
            open.disabled = false
          })
      })
      open.title = 'Show this folder in the file explorer'
      row.append(open)
      mounts.append(row)
    }
    card.append(mounts)
  }
  return card
}

function render(): void {
  if (sandboxes.length === 0) {
    listElement.replaceChildren(create('p', 'empty', 'No sandboxes found.'))
  } else {
    listElement.replaceChildren(...sandboxes.map(renderSandbox))
  }
}

async function refresh(): Promise<void> {
  if (loading) return
  loading = true
  refreshButton.disabled = true
  try {
    const result = await window.sandboxApi.list()
    if (!result.ok) {
      sandboxes = []
      listElement.replaceChildren()
      showNotice(result.message, 'list')
      return
    }
    // A failed refresh clears itself once listing works again; action errors stay until the next action.
    if (noticeSource === 'list') showNotice(null)
    sandboxes = result.sandboxes
    loginAvailable = result.loginAvailable
    render()
  } finally {
    loading = false
    refreshButton.disabled = false
  }
}

refreshButton.addEventListener('click', () => {
  void refresh()
})

window.setInterval(() => {
  if (!document.hidden) void refresh()
}, REFRESH_INTERVAL_MS)

void refresh()

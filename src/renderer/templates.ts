import { formatTemplateSize, validateTemplateTag, type TemplateInfo } from '../shared/templates'
import type { TransferResult } from '../shared/transfer'
import { setupDialogClose } from './dialog-common'

setupDialogClose(() => window.templatesApi.close())

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element #${id}`)
  return found as T
}

const noticeElement = element<HTMLElement>('notice')
const tagInput = element<HTMLInputElement>('tag')
const exportBox = element<HTMLInputElement>('export')
const saveButton = element<HTMLButtonElement>('save')
const loadButton = element<HTMLButtonElement>('load')
const refreshButton = element<HTMLButtonElement>('refresh')
const listElement = element<HTMLElement>('list')

/** True while a save, load or delete runs. */
let busy = false

function showNotice(message: string | null, kind: 'error' | 'ok' | 'info' = 'error'): void {
  if (message === null) {
    noticeElement.hidden = true
    return
  }
  noticeElement.textContent = message
  noticeElement.className = kind === 'info' ? 'notice' : `notice ${kind}`
  noticeElement.hidden = false
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function setBusy(value: boolean): void {
  busy = value
  saveButton.disabled = value
  loadButton.disabled = value
  refreshButton.disabled = value
  for (const button of listElement.querySelectorAll('button')) button.disabled = value
}

/** Runs one heavy operation of the main process and reports how it ended. Returns true when it succeeded. */
async function run(start: () => Promise<TransferResult>, waiting: string): Promise<boolean> {
  if (busy) return false
  setBusy(true)
  showNotice(waiting, 'info')
  try {
    const result = await start()
    showNotice(result.status === 'cancelled' ? null : result.message, result.status === 'done' ? 'ok' : 'error')
    return result.status === 'done'
  } catch (error) {
    showNotice(error instanceof Error ? error.message : 'The operation failed.')
    return false
  } finally {
    setBusy(false)
  }
}

function renderList(templates: TemplateInfo[]): void {
  if (templates.length === 0) {
    listElement.replaceChildren(create('p', 'empty', 'No templates yet.'))
    return
  }
  listElement.replaceChildren(
    ...templates.map((template) => {
      const row = create('div', 'row')
      const info = create('div', 'mount-paths')
      info.append(create('code', '', `${template.name}:${template.tag}`))
      if (template.flavor !== '') info.append(create('span', 'badge', template.flavor))
      const date = template.created > 0 ? new Date(template.created).toLocaleDateString() : ''
      info.append(create('span', 'hint', [formatTemplateSize(template.size), date].filter((part) => part !== '').join(' · ')))
      row.append(info)

      const remove = create('button', 'button danger', 'Delete')
      remove.type = 'button'
      remove.disabled = busy
      remove.addEventListener('click', () => {
        void run(() => window.templatesApi.remove(template.id), 'Waiting for your confirmation…').then((done) => {
          if (done) void refresh()
        })
      })
      row.append(remove)
      return row
    })
  )
}

async function refresh(): Promise<void> {
  refreshButton.disabled = true
  try {
    const result = await window.templatesApi.list()
    if (!result.ok) {
      listElement.replaceChildren()
      showNotice(result.message)
      return
    }
    renderList(result.templates)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : 'Could not list the templates.')
  } finally {
    refreshButton.disabled = busy
  }
}

saveButton.addEventListener('click', () => {
  const problem = validateTemplateTag(tagInput.value)
  if (problem !== null) {
    showNotice(problem)
    tagInput.focus()
    return
  }
  void run(
    () => window.templatesApi.save(tagInput.value.trim(), exportBox.checked),
    'Saving the template… this can take several minutes.'
  ).then((done) => {
    if (done) void refresh()
  })
})
tagInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveButton.click()
})

loadButton.addEventListener('click', () => {
  void run(() => window.templatesApi.load(), 'Working… the file picker may take a moment to appear.').then((done) => {
    if (done) void refresh()
  })
})
refreshButton.addEventListener('click', () => void refresh())
element<HTMLButtonElement>('back').addEventListener('click', () => {
  void window.templatesApi.back()
})

void window.templatesApi.context().then((context) => {
  if (context === null) {
    showNotice('This dialog was opened without a sandbox.')
    saveButton.disabled = true
    return
  }
  element<HTMLElement>('sandbox-name').textContent = context.sandbox
  element<HTMLElement>('running-hint').hidden = !context.running
  tagInput.focus()
})
void refresh()

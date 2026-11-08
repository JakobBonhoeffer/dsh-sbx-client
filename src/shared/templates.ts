/**
 * Contract between the main process and the Templates dialog, plus the pure helpers for
 * `sbx template` output and names. No Electron or Node imports on purpose, so the helpers can be
 * exercised on their own.
 */

import type { TransferResult } from './transfer'

/** One template image in the local image store of the sandbox runtime. */
export interface TemplateInfo {
  /** Short image id as printed by `sbx template ls`. Used to name the template in `sbx template rm`. */
  id: string
  /** Repository without the registry prefix `docker.io/library/`. */
  name: string
  tag: string
  /** The kind of image (for example `shell`); empty when sbx does not say. */
  flavor: string
  /** Creation time, milliseconds since the epoch. 0 when unknown. */
  created: number
  /** Size in bytes. */
  size: number
}

export type TemplateListResult = { ok: true; templates: TemplateInfo[] } | { ok: false; message: string }

export interface TemplatesContext {
  /** Sandbox the dialog was opened for (the one "Save" snapshots). */
  sandbox: string
  /** Whether that sandbox was running when the dialog was opened. */
  running: boolean
}

export interface TemplatesApi {
  context: () => Promise<TemplatesContext | null>
  /** The templates of this computer (the image store is shared by all sandboxes). */
  list: () => Promise<TemplateListResult>
  /**
   * Saves the sandbox as a template named `tag` (`name` or `name:tag`). With `exportFile` the main
   * process also asks where to write a tar file for use on another computer.
   */
  save: (tag: string, exportFile: boolean) => Promise<TransferResult>
  /** Asks for a tar file on this computer and loads it as a template. */
  load: () => Promise<TransferResult>
  /** Deletes one template (by the id from `list`) after a confirmation in a native dialog. */
  remove: (id: string) => Promise<TransferResult>
  /** Back to the Sandboxes dialog. */
  back: () => Promise<void>
  /** Closes this dialog. */
  close: () => Promise<void>
}

export const TEMPLATES_IPC = {
  context: 'templates:context',
  list: 'templates:list',
  save: 'templates:save',
  load: 'templates:load',
  remove: 'templates:remove',
  back: 'templates:back'
} as const

const REGISTRY_PREFIXES = ['docker.io/library/', 'docker.io/']

/** Strips the registry prefix that `sbx template ls` prints in front of local names. */
export function templateName(repository: string): string {
  for (const prefix of REGISTRY_PREFIXES) {
    if (repository.startsWith(prefix)) return repository.slice(prefix.length)
  }
  return repository
}

/** Image ids are lowercase hex; they end up as a command-line argument, so nothing else is accepted. */
export function isValidTemplateId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{6,64}$/.test(value)
}

/**
 * Parses the output of `sbx template ls --json`. Entries that do not look like templates are
 * skipped. Newest first.
 */
export function parseTemplates(output: string): TemplateInfo[] | null {
  const text = output.trim()
  if (text === '' || text === 'null') return []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(data)) return null

  const templates: TemplateInfo[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const id = entry['id']
    const repository = entry['repository']
    const tag = entry['tag']
    if (!isValidTemplateId(id) || typeof repository !== 'string' || typeof tag !== 'string') continue
    const created = typeof entry['created_at'] === 'string' ? Date.parse(entry['created_at']) : NaN
    const size = entry['size']
    templates.push({
      id,
      name: templateName(repository),
      tag,
      flavor: typeof entry['flavor'] === 'string' ? entry['flavor'] : '',
      created: Number.isFinite(created) ? created : 0,
      size: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0
    })
  }
  return templates.sort((a, b) => b.created - a.created)
}

const NAME_PART = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*'
const TAG_PATTERN = new RegExp(`^${NAME_PART}(?:/${NAME_PART})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$`)

/**
 * Returns an error message, or null when the value is acceptable as the name of a template. The
 * rules are those of container image names: lowercase letters, digits and `. _ -` inside a name,
 * `/` between parts, and an optional `:tag`. A name never starts with `-`, so it cannot be read as an option.
 */
export function validateTemplateTag(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'Enter a name for the template, for example my-template:v1.'
  if (trimmed.length > 200) return 'The name is too long.'
  if (!TAG_PATTERN.test(trimmed)) {
    return 'Use lowercase letters, digits and . _ - in the name, optionally followed by :tag (for example my-template:v1).'
  }
  return null
}

/** Human readable size, for example "1.5 GB". */
export function formatTemplateSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

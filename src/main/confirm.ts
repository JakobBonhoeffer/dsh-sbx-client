import { dialog, type BaseWindow } from 'electron'
import { baseName } from '../shared/sandbox-path'

/** How many conflicting names the confirmation lists before it says "and N more". */
const MAX_LISTED = 6

/**
 * Asks (native dialog) whether items may be deleted. Deleting cannot be undone, so "Cancel" is the
 * default answer. `shared` lists the places on the user's own computer that would lose files too
 * because the items lie inside a folder that is shared with the sandbox. Returns true only for "Delete".
 */
export async function confirmDelete(
  parent: BaseWindow,
  sandbox: string,
  paths: readonly string[],
  shared: readonly string[]
): Promise<boolean> {
  const listed = paths.slice(0, MAX_LISTED).map((path) => `• ${baseName(path)}`)
  if (paths.length > MAX_LISTED) listed.push(`… and ${paths.length - MAX_LISTED} more`)

  let detail = `${listed.join('\n')}\n\nFolders are deleted with everything inside them. This cannot be undone.`
  if (shared.length > 0) {
    detail +=
      `\n\nWARNING: ${shared.length === 1 ? 'This item is' : 'These items are'} in a folder that is shared with ` +
      `your computer. The files will be deleted there as well:\n${[...new Set(shared)].map((place) => `• ${place}`).join('\n')}`
  }

  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete items?',
    message: paths.length === 1 ? `Delete "${baseName(paths[0] ?? '')}" from ${sandbox}?` : `Delete ${paths.length} items from ${sandbox}?`,
    detail
  })
  return response === 0
}

/**
 * Asks (native dialog) whether existing items may be replaced. `sbx cp` replaces silently, so the
 * app always asks first. "Cancel" is the default answer. Returns true only for "Replace".
 */
export async function confirmReplace(
  parent: BaseWindow,
  where: string,
  existing: readonly string[]
): Promise<boolean> {
  const listed = existing.slice(0, MAX_LISTED).map((path) => `• ${baseName(path)}`)
  if (existing.length > MAX_LISTED) listed.push(`… and ${existing.length - MAX_LISTED} more`)

  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning',
    buttons: ['Replace', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Replace existing items?',
    message:
      existing.length === 1
        ? `An item with the same name already exists in ${where}.`
        : `${existing.length} items with the same names already exist in ${where}.`,
    detail: `${listed.join('\n')}\n\nThey will be replaced.`
  })
  return response === 0
}

/**
 * Pure parser for directory listings produced inside a sandbox. No Electron or Node imports on
 * purpose, so the logic can be exercised on its own.
 *
 * The listing command is `find -H DIR -mindepth 1 -maxdepth 1 -printf` with the format
 * `%y\t%Y\t%s\t%T@\t%f\0`: entry type, type after following a link, size, modification time in
 * seconds, and the name. Records end with a NUL byte, which cannot occur in a file name, so even
 * names with spaces, tabs or line breaks come through intact (the name is last and may contain tabs).
 */

import type { FileEntry } from '../shared/explorer'

/** The `find` arguments (after the directory) that produce the format described above. */
export const LISTING_PRINTF = '%y\\t%Y\\t%s\\t%T@\\t%f\\0'

export function parseListing(output: string, limit: number): { entries: FileEntry[]; truncated: boolean } {
  const entries: FileEntry[] = []
  let truncated = false

  for (const record of output.split('\0')) {
    if (record === '') continue
    const parts = record.split('\t')
    if (parts.length < 5) continue

    const [type, targetType, size, modified] = parts
    // The name is everything after the fourth tab (a name may itself contain tabs).
    const name = parts.slice(4).join('\t')
    if (name === '') continue

    if (entries.length >= limit) {
      truncated = true
      break
    }
    entries.push({
      name,
      isDirectory: type === 'd' || targetType === 'd',
      isSymlink: type === 'l',
      size: Number(size) || 0,
      modified: Math.round((Number.parseFloat(modified ?? '0') || 0) * 1000)
    })
  }

  return { entries: sortEntries(entries), truncated }
}

/** Directories first, then by name without regard to case; ties keep a stable order. */
export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    return byName !== 0 ? byName : a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

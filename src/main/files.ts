import { MAX_LISTED_ENTRIES, type FileEntry } from '../shared/explorer'
import { LISTING_PRINTF, parseListing } from './listing'
import { runSbx } from './sbx'

const LIST_TIMEOUT_MS = 30_000
const CHANGE_TIMEOUT_MS = 20_000
const REMOVE_TIMEOUT_MS = 120_000

/** Creates one folder (not its parents). Fails if it already exists. Runs as the regular sandbox user. */
export async function makeDirectory(sandbox: string, path: string): Promise<void> {
  await runSbx(['exec', sandbox, 'mkdir', '--', path], { timeoutMs: CHANGE_TIMEOUT_MS })
}

/**
 * Renames or moves one item. Refuses to replace an existing item: `mv` would overwrite a file
 * silently. Both paths are arguments of the script (`"$1"`, `"$2"`), never part of it.
 */
export async function renameEntry(sandbox: string, from: string, to: string): Promise<void> {
  const script =
    'if [ -e "$2" ] || [ -L "$2" ]; then echo "an item with that name already exists" >&2; exit 3; fi; mv -- "$1" "$2"'
  await runSbx(['exec', sandbox, 'sh', '-c', script, 'sh', from, to], { timeoutMs: CHANGE_TIMEOUT_MS })
}

/**
 * Deletes items recursively. `--one-file-system` makes `rm` stay on the file system of each path
 * and never descend into another one, so a folder of this computer that is mounted somewhere below
 * is not reached through a parent. `--` ends the options. No `-f`: problems are reported.
 */
export async function removeEntries(sandbox: string, paths: readonly string[]): Promise<void> {
  await runSbx(['exec', sandbox, 'rm', '-r', '--one-file-system', '--', ...paths], { timeoutMs: REMOVE_TIMEOUT_MS })
}

/**
 * Lists one directory inside a sandbox. The path is passed to the shell as an argument (`"$1"`),
 * never spliced into the script, so special characters in it cannot change what runs. `-H` follows
 * the path itself if it is a symlink to a directory, so a link can be browsed like the folder it
 * points to. Throws SbxError (for example when the directory does not exist or is not readable).
 */
export async function listDirectory(
  sandbox: string,
  path: string
): Promise<{ entries: FileEntry[]; truncated: boolean }> {
  const script = `find -H "$1" -mindepth 1 -maxdepth 1 -printf '${LISTING_PRINTF}'`
  const output = await runSbx(['exec', sandbox, 'sh', '-c', script, 'sh', path], { timeoutMs: LIST_TIMEOUT_MS })
  return parseListing(output, MAX_LISTED_ENTRIES)
}

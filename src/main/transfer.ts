import { isAbsolute } from 'node:path'
import { isValidSandboxName } from '../shared/sandbox'
import { asDirectoryArgument } from '../shared/sandbox-path'
import { listSandboxes } from './sandboxes'
import { runSbx, SbxError } from './sbx'

/** Copying can move large files, so it gets a generous limit. */
const COPY_TIMEOUT_MS = 10 * 60 * 1000
const QUICK_TIMEOUT_MS = 20_000

/** Throws unless the sandbox exists and is running: `sbx cp` would silently start a stopped one. */
export async function requireRunningSandbox(name: string): Promise<void> {
  if (!isValidSandboxName(name)) throw new SbxError('Invalid sandbox name.', 'failed')
  const sandbox = (await listSandboxes()).find((item) => item.name === name)
  if (!sandbox) throw new SbxError('That sandbox does not exist.', 'failed')
  if (!sandbox.running) throw new SbxError('That sandbox is not running. Start it first.', 'failed')
}

/** The home directory of the sandbox user, or null when it cannot be determined. */
export async function getSandboxHome(name: string): Promise<string | null> {
  const output = await runSbx(['exec', name, 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: QUICK_TIMEOUT_MS })
  const home = output.trim()
  return home.startsWith('/') && !/[\u0000-\u001f]/.test(home) ? home : null
}

/**
 * Returns the paths from `paths` that already exist in the sandbox. The paths are handed to the
 * shell as separate arguments (`"$@"`), never spliced into the script, so names with spaces or
 * special characters cannot change what runs.
 */
export async function findExistingInSandbox(name: string, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0) return []
  const script = 'for p in "$@"; do if [ -e "$p" ]; then printf "%s\\n" "$p"; fi; done; exit 0'
  const output = await runSbx(['exec', name, 'sh', '-c', script, 'sh', ...paths], { timeoutMs: QUICK_TIMEOUT_MS })
  return output.split('\n').filter((line) => line !== '')
}

/** Copies a file or folder from this computer INTO a folder of the sandbox. */
export async function copyToSandbox(name: string, hostPath: string, destinationDir: string): Promise<void> {
  // Host paths come from a native picker and are absolute. This also keeps them from ever being read as an option.
  if (!isAbsolute(hostPath)) throw new SbxError('Invalid file path.', 'failed')
  await runSbx(['cp', hostPath, `${name}:${asDirectoryArgument(destinationDir)}`], { timeoutMs: COPY_TIMEOUT_MS })
}

/**
 * `sbx cp` creates everything it copies as root. The regular sandbox user (and a DSH that runs as
 * that user) could then read the files but not change, rename or delete them. This hands the
 * copied item (recursively) to the regular user. Best effort: returns false when it did not work,
 * the copy itself stays valid either way.
 */
export async function giveToSandboxUser(name: string, sandboxPath: string): Promise<boolean> {
  try {
    const ids = (
      await runSbx(['exec', name, 'sh', '-c', 'printf "%s:%s" "$(id -u)" "$(id -g)"'], {
        timeoutMs: QUICK_TIMEOUT_MS
      })
    ).trim()
    // Numeric ids only: they are placed on the chown command line.
    if (!/^\d{1,10}:\d{1,10}$/.test(ids)) return false
    // `-h` does not follow symlinks and `--` ends the options, so the path can never act as one.
    await runSbx(['exec', '-u', 'root', name, 'chown', '-R', '-h', ids, '--', sandboxPath], {
      timeoutMs: COPY_TIMEOUT_MS
    })
    return true
  } catch {
    return false
  }
}

/** Copies a file or folder from the sandbox INTO a folder on this computer. */
export async function copyFromSandbox(name: string, sandboxPath: string, hostDir: string): Promise<void> {
  if (!isAbsolute(hostDir)) throw new SbxError('Invalid destination folder.', 'failed')
  await runSbx(['cp', `${name}:${sandboxPath}`, hostDir], { timeoutMs: COPY_TIMEOUT_MS })
}

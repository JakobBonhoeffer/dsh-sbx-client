/**
 * Pure parser for the `mounts` entries of `sbx ls --format json`. No Electron or Node imports on
 * purpose, so the logic can be exercised on its own.
 *
 * An entry looks like `HOSTPATH:SANDBOXPATH` with an optional `:ro` suffix, for example
 * `F:\work:/f/work` or `F:\share\in:/f/share/in:ro`.
 */

export interface ParsedMount {
  /** Folder or file on this computer. */
  hostPath: string
  /** Where it appears inside the sandbox (always starts with `/`). */
  sandboxPath: string
  readOnly: boolean
}

export function parseMount(entry: string): ParsedMount | null {
  let rest = entry.trim()
  if (/[\u0000-\u001f]/.test(rest)) return null

  let readOnly = false
  if (rest.endsWith(':ro')) {
    readOnly = true
    rest = rest.slice(0, -3)
  }

  // A Windows host path contains a colon of its own (the drive letter), but the sandbox path
  // always starts with "/", so the LAST ":/" is the separator.
  const separator = rest.lastIndexOf(':/')
  if (separator <= 0) return null

  const hostPath = rest.slice(0, separator)
  const sandboxPath = rest.slice(separator + 1)
  if (hostPath === '' || !sandboxPath.startsWith('/')) return null
  return { hostPath, sandboxPath, readOnly }
}

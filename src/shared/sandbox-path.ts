/**
 * Pure helpers for paths inside a sandbox (always POSIX style). No Electron or Node imports on
 * purpose, so the logic can be exercised on its own.
 */

/**
 * Expands a leading `~` to the sandbox user's home directory and removes trailing slashes.
 * Returns null when the path uses `~` but the home directory is unknown. The input must already
 * have passed `validateSandboxPath`.
 */
export function resolveSandboxPath(input: string, home: string | null): string | null {
  const trimmed = input.trim()
  let resolved = trimmed
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    if (home === null) return null
    resolved = home + trimmed.slice(1)
  }
  const withoutTrailing = resolved.replace(/\/+$/, '')
  return withoutTrailing === '' ? '/' : withoutTrailing
}

/** Last path segment ("/a/b/c.txt" -> "c.txt"). Works for host paths too (backslashes count). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? ''
}

/** Joins a sandbox directory and an entry name without doubling slashes. */
export function joinSandboxPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

/** The folder that contains `path`. The parent of "/" is "/". */
export function parentSandboxPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

/**
 * Breadcrumb segments of an absolute path: "/a/b" becomes "/", "a", "b", each with the full path
 * up to and including it.
 */
export function pathSegments(path: string): Array<{ name: string; path: string }> {
  const segments = [{ name: '/', path: '/' }]
  let current = ''
  for (const part of path.split('/').filter((item) => item !== '')) {
    current += `/${part}`
    segments.push({ name: part, path: current })
  }
  return segments
}

/**
 * The destination argument for `sbx cp` when copying INTO a folder: a trailing slash makes sure
 * the copy is placed inside the folder instead of replacing something that has its name.
 */
export function asDirectoryArgument(dir: string): string {
  return dir === '/' ? '/' : `${dir}/`
}

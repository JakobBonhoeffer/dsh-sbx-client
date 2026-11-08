/**
 * Safety rules for changing files inside a sandbox. Pure functions without imports, used by the
 * main process (the authority) and by the page (to give feedback early).
 */

/** Everything the rules need to know about the sandbox. */
export interface ProtectionContext {
  /** Home folder of the sandbox user. Null if unknown. */
  home: string | null
  /** Paths inside the sandbox that are folders of this computer mounted into it. */
  mounts: readonly string[]
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((part) => part !== '')
}

/** True when `path` is `ancestor` itself or lies below it. */
export function isSameOrBelow(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor === '/' ? '/' : `${ancestor}/`)
}

/**
 * Returns why an item must not be deleted or renamed, or null when it may be. `path` must be
 * absolute without a trailing slash. Deliberately strict: the file system root, every direct child
 * of it, the home folder and its parents, and every shared folder together with everything that
 * contains one are off limits, because losing them would break the sandbox or delete files on the
 * user's own computer.
 */
export function protectedReason(path: string, context: ProtectionContext): string | null {
  if (!path.startsWith('/')) return 'the path is not absolute'
  const segments = segmentsOf(path)
  if (segments.length === 0) return 'it is the file system root'
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'the path contains "." or ".."'
  }
  if (segments.length === 1) return 'it is a top-level folder of the file system'
  if (context.home !== null && isSameOrBelow(context.home, path)) {
    return 'it is the home folder or one of its parents'
  }
  for (const mount of context.mounts) {
    if (isSameOrBelow(mount, path)) return 'it is a shared folder or contains one'
  }
  return null
}

/** The mount that `path` lies inside (not the mount itself), or null. */
export function containingMount(path: string, mounts: readonly string[]): string | null {
  for (const mount of mounts) {
    if (path !== mount && isSameOrBelow(path, mount)) return mount
  }
  return null
}

/** The longest name a file system entry may have (bytes). */
const MAX_NAME_BYTES = 255

/**
 * Returns an error message, or null when `name` is acceptable as the name of one entry (a new
 * folder or the new name in a rename). It can never contain a path separator, so it cannot move
 * an item out of its folder.
 */
export function validateEntryName(name: string): string | null {
  if (name === '' || name.trim() === '') return 'Enter a name.'
  if (name === '.' || name === '..') return 'This name is not allowed.'
  if (name.includes('/')) return 'A name cannot contain "/".'
  if (/[\u0000-\u001f]/.test(name)) return 'The name contains invalid characters.'
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) return 'The name is too long.'
  return null
}

/**
 * Chooses the folder for the app's own log files. Pure (no Electron or Node imports): everything
 * it needs is passed in, so the decision can be tested without touching a disk.
 *
 * Preference order, first folder that is writable wins:
 *  1. portable build: `logs` next to the portable exe (its install folder is a temporary one)
 *  2. installed build: `logs` in the install folder, next to the app
 *  3. development: `logs` in the project folder
 *  4. fallback: the per-user log folder of the app (always writable)
 */

export interface LogDirInputs {
  /** True for a built app, false when run from the source tree. */
  packaged: boolean
  /** Folder of the portable exe (`PORTABLE_EXECUTABLE_DIR`), when running the portable build. */
  portableDir: string | undefined
  /** Folder of the running executable. */
  execDir: string
  /** The project folder when running from the source tree. */
  projectDir: string
  /** The per-user log folder, used when nothing else is writable. */
  userLogsDir: string
  /** Joins path segments (the caller's platform rules). */
  join: (...parts: string[]) => string
  /** True when files can be created in this folder (the caller creates it if needed). */
  canWrite: (dir: string) => boolean
}

export interface LogDirChoice {
  dir: string
  /** True when the preferred folder was not writable and the per-user folder is used instead. */
  fallback: boolean
}

export function chooseLogDir(inputs: LogDirInputs): LogDirChoice {
  const preferred = inputs.packaged
    ? inputs.portableDir
      ? inputs.join(inputs.portableDir, 'logs')
      : inputs.join(inputs.execDir, 'logs')
    : inputs.join(inputs.projectDir, 'logs')

  if (inputs.canWrite(preferred)) return { dir: preferred, fallback: false }
  return { dir: inputs.userLogsDir, fallback: true }
}

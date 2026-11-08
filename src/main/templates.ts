import { isAbsolute } from 'node:path'
import { isValidTemplateId, parseTemplates, validateTemplateTag, type TemplateInfo } from '../shared/templates'
import { isValidSandboxName } from '../shared/sandbox'
import { runSbx, SbxError } from './sbx'

const LIST_TIMEOUT_MS = 30_000
/** Snapshots, exports and loads move whole images (often a gigabyte or more). */
const HEAVY_TIMEOUT_MS = 30 * 60 * 1000

/** Lists the template images of the local runtime. Throws SbxError. */
export async function listTemplates(): Promise<TemplateInfo[]> {
  const output = await runSbx(['template', 'ls', '--json'], { timeoutMs: LIST_TIMEOUT_MS })
  const templates = parseTemplates(output)
  if (templates === null) throw new SbxError('Unexpected output from "sbx template ls".', 'failed')
  return templates
}

/**
 * Saves a snapshot of a sandbox as a template, optionally also as a tar file. Both values were
 * validated by the caller and are checked again here; neither can be read as an option (names
 * never start with `-`, the file is an absolute path).
 */
export async function saveTemplate(sandbox: string, tag: string, exportFile: string | null): Promise<void> {
  if (!isValidSandboxName(sandbox)) throw new SbxError('Invalid sandbox name.', 'failed')
  const problem = validateTemplateTag(tag)
  if (problem !== null) throw new SbxError(problem, 'failed')
  const args = ['template', 'save', sandbox, tag]
  if (exportFile !== null) {
    if (!isAbsolute(exportFile)) throw new SbxError('Invalid file path.', 'failed')
    args.push('--output', exportFile)
  }
  await runSbx(args, { timeoutMs: HEAVY_TIMEOUT_MS })
}

/** Loads a template from a tar file chosen in a native picker. */
export async function loadTemplate(file: string): Promise<void> {
  if (!isAbsolute(file)) throw new SbxError('Invalid file path.', 'failed')
  await runSbx(['template', 'load', file], { timeoutMs: HEAVY_TIMEOUT_MS })
}

/**
 * Removes one template image by its id. `--force` skips sbx's own question: there is no terminal
 * to answer it (the call fails without it), and the app has already asked in its own dialog.
 */
export async function removeTemplate(id: string): Promise<void> {
  if (!isValidTemplateId(id)) throw new SbxError('Invalid template id.', 'failed')
  await runSbx(['template', 'rm', '--force', id], { timeoutMs: LIST_TIMEOUT_MS })
}

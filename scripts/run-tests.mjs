// Runs every unit test in tests/ with Node's built-in TypeScript support. The tests cover the pure
// modules (no Electron, no sbx); each file exits with a non-zero code when a case fails.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../tests/', import.meta.url))
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.mts'))
  .sort()

let failed = 0
for (const file of files) {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(dir, file)], {
    encoding: 'utf8'
  })
  if (run.status === 0) {
    const lines = (run.stdout || '').trim().split('\n')
    console.log(`ok    ${file.padEnd(24)} ${lines[lines.length - 1] ?? ''}`)
  } else {
    failed++
    console.log(`FAIL  ${file}`)
    console.log(run.stdout)
    console.log(run.stderr)
  }
}
console.log(failed === 0 ? `\nall ${files.length} test files passed` : `\n${failed} of ${files.length} test files failed`)
process.exit(failed === 0 ? 0 : 1)

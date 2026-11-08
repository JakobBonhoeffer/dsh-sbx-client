import { parseListing } from '../src/main/listing.ts'

const LIMIT = 2000
let failed = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n     got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`)
}
const rec = (y: string, Y: string, s: string, t: string, name: string) => `${y}\t${Y}\t${s}\t${t}\t${name}\0`

const out =
  rec('f', 'f', '120', '1700000000.5', 'b.txt') +
  rec('d', 'd', '4096', '1700000100.0', 'Zeta') +
  rec('f', 'f', '1', '1700000200.0', 'A file with spaces.txt') +
  rec('d', 'd', '4096', '1700000300.0', 'alpha') +
  rec('l', 'd', '9', '1700000400.0', 'link-to-dir') +
  rec('l', 'f', '9', '1700000500.0', 'link-to-file') +
  rec('l', 'N', '9', '1700000600.0', 'broken-link') +
  rec('f', 'f', '5', '1700000700.0', 'tab\there') +
  rec('f', 'f', '5', '1700000800.0', 'line\nbreak') +
  rec('f', 'f', '10', '1700000900.0', 'file10') +
  rec('f', 'f', '10', '1700001000.0', 'file2')

const { entries, truncated } = parseListing(out, LIMIT)
eq('not truncated', truncated, false)
eq('count', entries.length, 11)
eq('directories first, then names case-insensitively and numerically', entries.map((e) => e.name), [
  'alpha', 'link-to-dir', 'Zeta',
  'A file with spaces.txt', 'b.txt', 'broken-link', 'file2', 'file10', 'line\nbreak', 'link-to-file', 'tab\there'
])
const byName = (n: string) => entries.find((e) => e.name === n)
eq('plain file', byName('b.txt'), { name: 'b.txt', isDirectory: false, isSymlink: false, size: 120, modified: 1700000000500 })
eq('symlink to a directory counts as directory', [byName('link-to-dir')?.isDirectory, byName('link-to-dir')?.isSymlink], [true, true])
eq('symlink to a file is a file', [byName('link-to-file')?.isDirectory, byName('link-to-file')?.isSymlink], [false, true])
eq('broken symlink is a non-directory link', [byName('broken-link')?.isDirectory, byName('broken-link')?.isSymlink], [false, true])
eq('name with a tab survives', byName('tab\there')?.name, 'tab\there')
eq('name with a line break survives', byName('line\nbreak')?.name, 'line\nbreak')
eq('mtime keeps milliseconds', byName('b.txt')?.modified, 1700000000500)

eq('empty output', parseListing('', LIMIT), { entries: [], truncated: false })
eq('garbage records are skipped', parseListing('nonsense\0only\ttwo\0', LIMIT).entries, [])
eq('record without a name is skipped', parseListing('f\tf\t1\t1.0\t\0', LIMIT).entries, [])

let big = ''
for (let i = 0; i < 2105; i++) big += rec('f', 'f', '1', '1.0', `f${i}`)
const capped = parseListing(big, LIMIT)
eq('large directory is cut at the limit', [capped.entries.length, capped.truncated], [2000, true])
const exact = parseListing(big.split('\0').slice(0, 2000).join('\0') + '\0', LIMIT)
eq('exactly at the limit is not truncated', [exact.entries.length, exact.truncated], [2000, false])

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

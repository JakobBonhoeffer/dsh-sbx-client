import { containingMount, isSameOrBelow, protectedReason, validateEntryName } from '../src/shared/protect.ts'

let failed = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n     got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`)
}
const ctx = { home: '/home/user', mounts: ['/c/project', '/c/share/in', '/c/share/out'] }
const blocked = (path: string) => typeof protectedReason(path, ctx) === 'string'
const allowed = (path: string) => protectedReason(path, ctx) === null

console.log('-- protectedReason: must be refused')
eq('root', blocked('/'), true)
eq('top-level system folder /etc', blocked('/etc'), true)
eq('top-level custom folder /data', blocked('/data'), true)
eq('/home (parent of home)', blocked('/home'), true)
eq('home folder itself', blocked('/home/user'), true)
eq('/f (contains the shared folders)', blocked('/f'), true)
eq('/c/share (contains two shared folders)', blocked('/c/share'), true)
eq('a shared folder itself', blocked('/c/project'), true)
eq('a read-only shared folder itself', blocked('/c/share/in'), true)
eq('dot segment', blocked('/home/user/./x'), true)
eq('dot-dot segment', blocked('/home/user/../../etc/x'), true)
eq('relative path', blocked('work/x'), true)

console.log('-- protectedReason: must be allowed')
eq('file in home', allowed('/home/user/notes.txt'), true)
eq('folder in home', allowed('/home/user/workspace/old'), true)
eq('item below /tmp', allowed('/tmp/test'), true)
eq('item inside a shared folder (needs a warning, not a ban)', allowed('/c/project/build'), true)
eq('similar prefix is not a shared folder', allowed('/c/project2/x'), true)
eq('other home below /home', allowed('/home/ubuntu/x'), true)

console.log('-- containingMount')
eq('inside a shared folder', containingMount('/c/project/build/out.bin', ctx.mounts), '/c/project')
eq('the mount itself is not "inside"', containingMount('/c/project', ctx.mounts), null)
eq('outside every mount', containingMount('/home/user/x', ctx.mounts), null)
eq('similar prefix is not inside', containingMount('/c/project2/x', ctx.mounts), null)

console.log('-- isSameOrBelow')
eq('equal', isSameOrBelow('/a/b', '/a/b'), true)
eq('below', isSameOrBelow('/a/b/c', '/a/b'), true)
eq('sibling with common prefix', isSameOrBelow('/a/bc', '/a/b'), false)
eq('everything is below the root', isSameOrBelow('/a', '/'), true)

console.log('-- validateEntryName')
const bad = (n: string) => typeof validateEntryName(n) === 'string'
eq('empty', bad(''), true)
eq('only spaces', bad('   '), true)
eq('dot', bad('.'), true)
eq('dot dot', bad('..'), true)
eq('slash', bad('a/b'), true)
eq('leading slash', bad('/etc'), true)
eq('newline', bad('a\nb'), true)
eq('NUL', bad('a\u0000b'), true)
eq('too long (256 ASCII bytes)', bad('a'.repeat(256)), true)
eq('too long in bytes (130 two-byte characters)', bad('ä'.repeat(130)), true)
eq('exactly 255 bytes is fine', bad('a'.repeat(255)), false)
eq('normal name', validateEntryName('report 2026.txt'), null)
eq('leading dot', validateEntryName('.hidden'), null)
eq('unicode', validateEntryName('Übersicht – Größe.md'), null)
eq('backslash is a legal character on Linux', validateEntryName('a\\b'), null)

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

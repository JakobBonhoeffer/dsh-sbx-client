import { parseMount } from '../src/main/mounts.ts'

let failed = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n     got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`)
}

eq('windows read-write', parseMount('C:\\work:/c/work'), { hostPath: 'C:\\work', sandboxPath: '/c/work', readOnly: false })
eq('windows read-only', parseMount('C:\\share\\in:/c/share/in:ro'), { hostPath: 'C:\\share\\in', sandboxPath: '/c/share/in', readOnly: true })
eq('forward slashes on the host', parseMount('C:/work:/c/work'), { hostPath: 'C:/work', sandboxPath: '/c/work', readOnly: false })
eq('posix host path', parseMount('/home/me/project:/home/me/project'), { hostPath: '/home/me/project', sandboxPath: '/home/me/project', readOnly: false })
eq('space in the host path', parseMount('C:\\My Projects\\a b:/c/my/a b'), { hostPath: 'C:\\My Projects\\a b', sandboxPath: '/c/my/a b', readOnly: false })
eq('surrounding whitespace', parseMount('  C:\\work:/c/work  '), { hostPath: 'C:\\work', sandboxPath: '/c/work', readOnly: false })
eq('single file mount', parseMount('C:\\work\\.env:/c/work/.env:ro'), { hostPath: 'C:\\work\\.env', sandboxPath: '/c/work/.env', readOnly: true })
eq('no separator', parseMount('C:\\work'), null)
eq('empty', parseMount(''), null)
eq('only a sandbox path', parseMount(':/c/work'), null)
eq('control character', parseMount('C:\\wo\nrk:/c/work'), null)
eq('NUL byte', parseMount('C:\\work\u0000:/c/work'), null)

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

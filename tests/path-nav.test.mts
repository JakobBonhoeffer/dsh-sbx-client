import { parentSandboxPath, pathSegments } from '../src/shared/sandbox-path.ts'

let failed = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n     got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`)
}

eq('parent of a nested path', parentSandboxPath('/home/user/work'), '/home/user')
eq('parent of a top-level folder is the root', parentSandboxPath('/home'), '/')
eq('parent of the root is the root', parentSandboxPath('/'), '/')
eq('trailing slash is ignored', parentSandboxPath('/home/user/'), '/home')
eq('segments of a nested path', pathSegments('/a/b'), [
  { name: '/', path: '/' },
  { name: 'a', path: '/a' },
  { name: 'b', path: '/a/b' }
])
eq('segments of the root', pathSegments('/'), [{ name: '/', path: '/' }])
eq('doubled slashes are collapsed', pathSegments('/a//b/'), [
  { name: '/', path: '/' },
  { name: 'a', path: '/a' },
  { name: 'b', path: '/a/b' }
])

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

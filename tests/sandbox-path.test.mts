import { asDirectoryArgument, baseName, joinSandboxPath, resolveSandboxPath } from '../src/shared/sandbox-path.ts'
import { validateSandboxPath } from '../src/shared/transfer.ts'

let failed = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n     got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`)
}

console.log('-- resolveSandboxPath')
eq('absolute stays', resolveSandboxPath('/tmp/x', '/home/user'), '/tmp/x')
eq('trailing slashes removed', resolveSandboxPath('/tmp/x///', '/home/user'), '/tmp/x')
eq('root stays root', resolveSandboxPath('/', '/home/user'), '/')
eq('tilde alone', resolveSandboxPath('~', '/home/user'), '/home/user')
eq('tilde slash', resolveSandboxPath('~/work/', '/home/user'), '/home/user/work')
eq('tilde without known home', resolveSandboxPath('~/work', null), null)
eq('absolute without home is fine', resolveSandboxPath('/opt', null), '/opt')
eq('surrounding spaces trimmed', resolveSandboxPath('  /tmp/a  ', null), '/tmp/a')

console.log('-- baseName / joinSandboxPath / asDirectoryArgument')
eq('posix basename', baseName('/a/b/c.txt'), 'c.txt')
eq('windows basename', baseName('C:\\Users\\x\\my file.txt'), 'my file.txt')
eq('folder with trailing slash', baseName('/a/b/'), 'b')
eq('join normal', joinSandboxPath('/tmp', 'a.txt'), '/tmp/a.txt')
eq('join at root', joinSandboxPath('/', 'a.txt'), '/a.txt')
eq('dir argument', asDirectoryArgument('/tmp'), '/tmp/')
eq('dir argument at root', asDirectoryArgument('/'), '/')

console.log('-- validateSandboxPath')
eq('absolute ok', validateSandboxPath('/home/user/x'), null)
eq('tilde ok', validateSandboxPath('~/x'), null)
eq('lone tilde ok', validateSandboxPath('~'), null)
eq('empty rejected', typeof validateSandboxPath('   '), 'string')
eq('relative rejected', typeof validateSandboxPath('work/x'), 'string')
eq('tilde user rejected', typeof validateSandboxPath('~root/x'), 'string')
eq('option-like rejected', typeof validateSandboxPath('-rf'), 'string')
eq('newline rejected', typeof validateSandboxPath('/tmp/a\nb'), 'string')
eq('NUL rejected', typeof validateSandboxPath('/tmp/a\u0000b'), 'string')
eq('too long rejected', typeof validateSandboxPath('/' + 'a'.repeat(5000)), 'string')

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

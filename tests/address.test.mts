import { applyPortPlaceholder, buildLoginUrl, extractToken, pickAutoConnectUrl } from '../src/main/address.ts'

let failed = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n     got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`)
}
const ports = [
  { hostPort: 3080, sandboxPort: 3081 },
  { hostPort: 60000, sandboxPort: 3081 }
]

console.log('-- pickAutoConnectUrl')
eq('matching port', pickAutoConnectUrl('http://127.0.0.1:3080/', ports), 'http://127.0.0.1:3080/')
eq('keeps path', pickAutoConnectUrl('http://127.0.0.1:60000/ui/', ports), 'http://127.0.0.1:60000/ui/')
eq('other port', pickAutoConnectUrl('http://127.0.0.1:4000/', ports), null)
eq('other host', pickAutoConnectUrl('http://192.168.1.5:3080/', ports), null)
eq('https not used', pickAutoConnectUrl('https://127.0.0.1:3080/', ports), null)
eq('null url', pickAutoConnectUrl(null, ports), null)
eq('garbage url', pickAutoConnectUrl('not a url', ports), null)
eq('no ports', pickAutoConnectUrl('http://127.0.0.1:3080/', []), null)

console.log('-- extractToken')
eq('full url', extractToken('dsh web: http://127.0.0.1:3080/?token=abcDEF_123-x\n'), 'abcDEF_123-x')
eq('bare token', extractToken('token=XYZ789'), 'XYZ789')
eq('last of several', extractToken('http://h/?token=old1\nhttp://h/?token=new2\n'), 'new2')
eq('stops at delimiter', extractToken('url?token=abc&x=1 and more'), 'abc')
eq('no token', extractToken('nothing to see here'), null)
eq('empty output', extractToken(''), null)
eq('shell metacharacters are not taken', extractToken('token=abc;echo pwned'), 'abc')
eq('empty value', extractToken('token='), null)

console.log('-- applyPortPlaceholder / buildLoginUrl')
eq('placeholder replaced twice', applyPortPlaceholder('dsh-url {port} # {port}', 3080), 'dsh-url 3080 # 3080')
eq('no placeholder untouched', applyPortPlaceholder('echo hi', 3080), 'echo hi')
eq('login url uses the host port, never the output', buildLoginUrl(3080, 'T0k-en_'), 'http://127.0.0.1:3080/?token=T0k-en_')

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

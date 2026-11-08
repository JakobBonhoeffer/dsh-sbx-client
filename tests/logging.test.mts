import { DEFAULT_LOG_LEVEL, formatLogLine, isLogFileName, isLogLevel, levelAllows, maskSecrets, rotationSteps } from '../src/shared/logging.ts'
import { chooseLogDir } from '../src/main/log-dir.ts'

let failed = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n     got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`)
}

console.log('-- levels')
eq('default is info', DEFAULT_LOG_LEVEL, 'info')
eq('isLogLevel accepts the four', ['error', 'warn', 'info', 'debug'].every(isLogLevel), true)
eq('isLogLevel rejects others', [isLogLevel('trace'), isLogLevel(''), isLogLevel(3), isLogLevel(null)], [false, false, false, false])
eq('info records error, warn, info', [levelAllows('info', 'error'), levelAllows('info', 'warn'), levelAllows('info', 'info')], [true, true, true])
eq('info does not record debug', levelAllows('info', 'debug'), false)
eq('error records only errors', [levelAllows('error', 'error'), levelAllows('error', 'warn')], [true, false])
eq('debug records everything', ['error', 'warn', 'info', 'debug'].every((l) => levelAllows('debug', l as 'error')), true)

console.log('-- maskSecrets')
eq('url with token', maskSecrets('open http://127.0.0.1:3080/?token=Abc123_def-XYZ now'), 'open http://127.0.0.1:3080/?token=… now')
eq('bare token', maskSecrets('token=SECRET99'), 'token=…')
eq('two tokens', maskSecrets('token=a1 and token=b2'), 'token=… and token=…')
eq('no token untouched', maskSecrets('nothing secret here'), 'nothing secret here')
eq('empty value is left alone', maskSecrets('token='), 'token=')

console.log('-- formatLogLine')
const d = new Date('2026-11-08T21:50:12.345Z')
eq('plain line', formatLogLine(d, 'info', 'app', 'started'), '2026-11-08T21:50:12.345Z INFO  [app] started')
eq('level padding', formatLogLine(d, 'error', 'sbx', 'x'), '2026-11-08T21:50:12.345Z ERROR [sbx] x')
eq('warn padding', formatLogLine(d, 'warn', 'sbx', 'x'), '2026-11-08T21:50:12.345Z WARN  [sbx] x')
eq('newlines become \\n (one line per entry)', formatLogLine(d, 'info', 'a', 'one\ntwo\r\nthree'), '2026-11-08T21:50:12.345Z INFO  [a] one\\ntwo\\nthree')
eq('token is masked in the line', formatLogLine(d, 'info', 'conn', 'GET /?token=SECRET99').includes('SECRET99'), false)

console.log('-- rotationSteps')
eq('keep 5', rotationSteps(5), {
  remove: 'dsh-sbx-client.4.log',
  renames: [
    ['dsh-sbx-client.3.log', 'dsh-sbx-client.4.log'],
    ['dsh-sbx-client.2.log', 'dsh-sbx-client.3.log'],
    ['dsh-sbx-client.1.log', 'dsh-sbx-client.2.log'],
    ['dsh-sbx-client.log', 'dsh-sbx-client.1.log']
  ]
})
eq('keep 2', rotationSteps(2), { remove: 'dsh-sbx-client.1.log', renames: [['dsh-sbx-client.log', 'dsh-sbx-client.1.log']] })

console.log('-- isLogFileName')
eq('current and rotated', [isLogFileName('dsh-sbx-client.log'), isLogFileName('dsh-sbx-client.3.log')], [true, true])
eq('others rejected', [isLogFileName('other.log'), isLogFileName('dsh-sbx-client.txt'), isLogFileName('dsh-sbx-client.log.bak'), isLogFileName('x/dsh-sbx-client.log'), isLogFileName('dsh-sbx-client.a.log')], [false, false, false, false, false])

console.log('-- chooseLogDir')
const join = (...p: string[]) => p.join('/')
const base = { packaged: true, portableDir: undefined, execDir: 'C:/Apps/dsh', projectDir: 'D:/proj', userLogsDir: 'C:/Users/u/AppData/logs', join }
eq('installed build: logs next to the app', chooseLogDir({ ...base, canWrite: () => true }), { dir: 'C:/Apps/dsh/logs', fallback: false })
eq('portable build: logs next to the exe, not in the temp folder', chooseLogDir({ ...base, portableDir: 'E:/tools', canWrite: () => true }), { dir: 'E:/tools/logs', fallback: false })
eq('development: logs in the project', chooseLogDir({ ...base, packaged: false, canWrite: () => true }), { dir: 'D:/proj/logs', fallback: false })
eq('not writable: per-user fallback', chooseLogDir({ ...base, canWrite: () => false }), { dir: 'C:/Users/u/AppData/logs', fallback: true })
eq('portable not writable: per-user fallback', chooseLogDir({ ...base, portableDir: 'E:/tools', canWrite: (dir) => dir !== 'E:/tools/logs' }), { dir: 'C:/Users/u/AppData/logs', fallback: true })

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

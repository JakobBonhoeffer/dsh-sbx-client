import assert from 'node:assert/strict'
import {
  cleanLine,
  concatBytes,
  isValidLineCount,
  looksBinary,
  parseLogFinder,
  splitAtLastNewline,
  splitSizeHeader,
  stripAnsi,
  tailLines,
  toLines,
  MAX_LINE_LENGTH
} from '../src/shared/log-view.ts'

let count = 0
const t = (name: string, fn: () => void): void => {
  try {
    fn()
  } catch (error) {
    console.error(`FAILED: ${name}`)
    throw error
  }
  count++
}
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)
const text = (b: Uint8Array): string => new TextDecoder().decode(b)
const NUL = '\u0000'

t('valid line counts', () => {
  assert.ok(isValidLineCount(500))
  assert.ok(!isValidLineCount(501))
  assert.ok(!isValidLineCount('500'))
})
t('stripAnsi colors', () => assert.equal(stripAnsi('\u001b[31mred\u001b[0m ok'), 'red ok'))
t('stripAnsi cursor', () => assert.equal(stripAnsi('a\u001b[2K\u001b[1Gb'), 'ab'))
t('stripAnsi osc', () => assert.equal(stripAnsi('\u001b]0;title\u0007text'), 'text'))
t('stripAnsi osc st', () => assert.equal(stripAnsi('\u001b]8;;http://x\u001b\\link'), 'link'))
t('cleanLine CR end', () => assert.equal(cleanLine('text\r'), 'text'))
t('cleanLine progress', () => assert.equal(cleanLine('10%\r50%\r100%'), '100%'))
t('cleanLine control', () => assert.equal(cleanLine(`a${NUL}b\u0007c\td`), 'abc\td'))
t('cleanLine long', () => {
  const out = cleanLine('x'.repeat(MAX_LINE_LENGTH + 50))
  assert.equal(out.length, MAX_LINE_LENGTH + 1)
  assert.ok(out.endsWith('…'))
})
t('cleanLine keeps unicode', () => assert.equal(cleanLine('héllo ✓'), 'héllo ✓'))
t('binary', () => {
  assert.ok(looksBinary(Uint8Array.from([65, 0, 66])))
  assert.ok(!looksBinary(bytes('plain text\n')))
})
t('split at last newline', () => {
  const { complete, rest } = splitAtLastNewline(bytes('a\nb\npart'))
  assert.equal(text(complete), 'a\nb\n')
  assert.equal(text(rest), 'part')
})
t('split no newline', () => {
  const { complete, rest } = splitAtLastNewline(bytes('part'))
  assert.equal(complete.length, 0)
  assert.equal(text(rest), 'part')
})
t('split ends with newline', () => {
  const { complete, rest } = splitAtLastNewline(bytes('a\n'))
  assert.equal(text(complete), 'a\n')
  assert.equal(rest.length, 0)
})
t('split multibyte kept whole', () => {
  const { complete, rest } = splitAtLastNewline(bytes('é\nü'))
  assert.equal(text(complete), 'é\n')
  assert.equal(text(rest), 'ü')
})
t('concat', () => assert.equal(text(concatBytes(bytes('ab'), bytes('cd'))), 'abcd'))
t('header ok', () => {
  const parsed = splitSizeHeader(bytes('1234\nhello'))
  assert.equal(parsed?.size, 1234)
  assert.equal(text(parsed!.body), 'hello')
})
t('header with spaces', () => assert.equal(splitSizeHeader(bytes('  42\n'))?.size, 42))
t('header empty body', () => assert.equal(splitSizeHeader(bytes('0\n'))?.body.length, 0))
t('header missing', () => assert.equal(splitSizeHeader(bytes('hello')), null))
t('header not a number', () => assert.equal(splitSizeHeader(bytes('abc\nx')), null))
t('header empty line', () => assert.equal(splitSizeHeader(bytes('\nx')), null))
t('header negative', () => assert.equal(splitSizeHeader(bytes('-5\nx')), null))
t('toLines', () => assert.deepEqual(toLines('a\nb\n'), ['a', 'b']))
t('toLines empty', () => assert.deepEqual(toLines(''), []))
t('toLines blank line kept', () => assert.deepEqual(toLines('a\n\nb\n'), ['a', '', 'b']))
t('toLines cleans', () => assert.deepEqual(toLines('\u001b[32mok\u001b[0m\r\n'), ['ok']))
t('finder sorts newest first', () => {
  const out = `100.5\t10\t/a.log${NUL}300.25\t20\t/b.log${NUL}200\t30\t/c.log${NUL}`
  const found = parseLogFinder(out, 10)
  assert.deepEqual(
    found.map((f) => f.path),
    ['/b.log', '/c.log', '/a.log']
  )
  assert.equal(found[0]?.size, 20)
  assert.equal(found[0]?.modified, 300250)
})
t('finder path with tab and spaces', () => {
  const found = parseLogFinder(`1\t2\t/my dir/a\tb.log${NUL}`, 10)
  assert.equal(found[0]?.path, '/my dir/a\tb.log')
})
t('finder skips broken', () => {
  const out = `x\ty\t/a.log${NUL}nonsense${NUL}\t\t${NUL} 1\t2\trelative.log${NUL}`
  assert.equal(parseLogFinder(out, 10).length, 0)
})
t('finder limit', () => {
  const out = Array.from({ length: 5 }, (_, i) => `${i}\t1\t/f${i}.log${NUL}`).join('')
  assert.equal(parseLogFinder(out, 3).length, 3)
})
t('finder empty', () => assert.deepEqual(parseLogFinder('', 5), []))

t('tailLines last 2', () => assert.equal(text(tailLines(bytes('a\nb\nc\n'), 2).bytes), 'b\nc\n'))
t('tailLines cut flag', () => assert.equal(tailLines(bytes('a\nb\nc\n'), 2).cut, true))
t('tailLines exact', () => {
  const r = tailLines(bytes('a\nb\nc\n'), 3)
  assert.equal(text(r.bytes), 'a\nb\nc\n')
  assert.equal(r.cut, false)
})
t('tailLines fewer', () => assert.equal(text(tailLines(bytes('a\n'), 5).bytes), 'a\n'))
t('tailLines empty', () => assert.equal(tailLines(bytes(''), 5).bytes.length, 0))
t('tailLines one', () => assert.equal(text(tailLines(bytes('a\nb\n'), 1).bytes), 'b\n'))

console.log(`log-view: ${count} cases passed`)

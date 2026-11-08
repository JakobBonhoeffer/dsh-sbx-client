import assert from 'node:assert/strict'
import { parseTargetUrl } from '../src/main/target-url.ts'

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

t('host and port get http', () => assert.equal(parseTargetUrl('127.0.0.1:3080').loadUrl, 'http://127.0.0.1:3080/'))
t('the launch token is kept for loading but not for saving', () => {
  const parsed = parseTargetUrl('http://127.0.0.1:3080/?token=abc#x')
  assert.equal(parsed.loadUrl, 'http://127.0.0.1:3080/?token=abc#x')
  // The address that is saved never holds the token.
  assert.equal(parsed.cleanUrl, 'http://127.0.0.1:3080/')
})
for (const bad of ['', 'ftp://x', 'http://u:p@x/', 'http://']) {
  t(`refuses ${JSON.stringify(bad)}`, () => assert.throws(() => parseTargetUrl(bad)))
}

console.log(`target-url: ${count} cases passed`)

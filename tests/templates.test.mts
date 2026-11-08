import assert from 'node:assert/strict'
import { formatTemplateSize, isValidTemplateId, parseTemplates, templateName, validateTemplateTag } from '../src/shared/templates.ts'
let count = 0
const t = (name: string, fn: () => void): void => { try { fn() } catch (e) { console.error('FAILED: ' + name); throw e } count++ }

t('strip library prefix', () => assert.equal(templateName('docker.io/library/dsh-ready'), 'dsh-ready'))
t('strip docker.io', () => assert.equal(templateName('docker.io/me/app'), 'me/app'))
t('keep other registry', () => assert.equal(templateName('ghcr.io/me/app'), 'ghcr.io/me/app'))
t('id ok', () => assert.ok(isValidTemplateId('7a8bdaf3cdff')))
t('id too short', () => assert.ok(!isValidTemplateId('7a8')))
t('id uppercase', () => assert.ok(!isValidTemplateId('7A8BDAF3CDFF')))
t('id option-like', () => assert.ok(!isValidTemplateId('--force')))
t('id not string', () => assert.ok(!isValidTemplateId(123)))
const sample = JSON.stringify([
  { id: '7a8bdaf3cdff', repository: 'docker.io/library/dsh-ready', tag: 'v1', flavor: 'shell-docker', created_at: '2026-11-06T22:03:01Z', size: 1650922028 },
  { id: '4ec245bdff7f', repository: 'docker.io/library/kit', tag: 'x', created_at: '2026-09-22T06:14:04Z', size: 173963337 },
  { id: 'bad id', repository: 'r', tag: 't' },
  { repository: 'r', tag: 't' },
  'text', null
])
t('parse sample', () => {
  const list = parseTemplates(sample)!
  assert.equal(list.length, 2)
  assert.equal(list[0]!.name, 'dsh-ready')
  assert.equal(list[0]!.flavor, 'shell-docker')
  assert.equal(list[1]!.flavor, '')
  assert.equal(list[0]!.size, 1650922028)
})
t('parse newest first', () => assert.equal(parseTemplates(sample)![0]!.tag, 'v1'))
t('parse empty', () => assert.deepEqual(parseTemplates(''), []))
t('parse null', () => assert.deepEqual(parseTemplates('null'), []))
t('parse garbage', () => assert.equal(parseTemplates('{nope'), null))
t('parse non-array', () => assert.equal(parseTemplates('{}'), null))
t('parse bad date and size', () => {
  const l = parseTemplates(JSON.stringify([{ id: 'abcdef12', repository: 'a', tag: 'b', created_at: 'x', size: -5 }]))!
  assert.equal(l[0]!.created, 0)
  assert.equal(l[0]!.size, 0)
})
for (const ok of ['my-template', 'my-template:v1', 'a/b-c:1.2_3', 'dsh.ready:V1', 'x__y']) t('tag ok ' + ok, () => assert.equal(validateTemplateTag(ok), null))
for (const bad of ['', '  ', '-x', '--output', 'A', 'a b', 'a:', ':v1', 'a::b', 'a/', '/a', 'a;rm', 'a$(x)', 'a\nb', 'x'.repeat(201), 'a:-x', 'a..b', 'a--b-']) {
  t('tag bad ' + JSON.stringify(bad).slice(0, 20), () => assert.notEqual(validateTemplateTag(bad), null))
}
t('size kb', () => assert.equal(formatTemplateSize(2048), '2 KB'))
t('size mb', () => assert.equal(formatTemplateSize(173963337), '166 MB'))
t('size gb', () => assert.equal(formatTemplateSize(1650922028), '1.5 GB'))
console.log(`templates: ${count} cases passed`)

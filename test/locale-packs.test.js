import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readLocalePacks } from '../lib/locale-packs.js'

/** 每个用例一个临时目录，跑完删掉——语言包夹具不能落在仓库里。 */
function makeDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-locale-packs-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('reads every json pack and keys the result by language name', (t) => {
  const directory = makeDirectory(t)
  // 先写 ja 再写 es：结果的键顺序要由排序决定，不能跟着目录顺序走。
  writeFileSync(join(directory, 'ja.json'), JSON.stringify({ 'section.files': 'ファイル' }))
  writeFileSync(join(directory, 'es.json'), JSON.stringify({ 'section.files': 'Archivos' }))
  writeFileSync(join(directory, 'notes.txt'), 'not a pack')

  const packs = readLocalePacks(directory)
  assert.deepEqual(packs, {
    es: { 'section.files': 'Archivos' },
    ja: { 'section.files': 'ファイル' },
  })
  assert.deepEqual(Object.keys(packs), ['es', 'ja'])
})

test('accepts a file URL directory too, like the module default', (t) => {
  const directory = makeDirectory(t)
  writeFileSync(join(directory, 'en.json'), JSON.stringify({ 'section.files': 'Files' }))
  assert.deepEqual(readLocalePacks(pathToFileURL(directory)), {
    en: { 'section.files': 'Files' },
  })
})

test('skips a broken, unreadable or non-object pack instead of throwing', (t) => {
  const directory = makeDirectory(t)
  writeFileSync(join(directory, 'en.json'), JSON.stringify({ 'section.files': 'Files' }))
  writeFileSync(join(directory, 'broken.json'), '{ not json')
  writeFileSync(join(directory, 'list.json'), JSON.stringify(['a', 'b']))
  writeFileSync(join(directory, 'scalar.json'), JSON.stringify('hello'))
  writeFileSync(join(directory, 'null.json'), 'null')
  // 名字像语言包但其实是目录：读盘会失败，同样只该少这一门。
  mkdirSync(join(directory, 'de.json'))

  assert.deepEqual(readLocalePacks(directory), { en: { 'section.files': 'Files' } })
})

test('an empty directory has no packs', (t) => {
  assert.deepEqual(readLocalePacks(makeDirectory(t)), {})
})

test('a directory that does not exist has no packs', (t) => {
  const missing = join(makeDirectory(t), 'no-such-directory')
  assert.deepEqual(readLocalePacks(missing), {})
})

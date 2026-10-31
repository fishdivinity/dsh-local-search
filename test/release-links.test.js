import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPinnedToTag, expandLinks, isAbsoluteTarget } from '../scripts/expand-release-links.mjs'

const options = { notesPath: 'docs/releases/v0.2.0.md', repository: 'fishdivinity/dsh-local-search', tag: 'v0.2.0' }

test('isAbsoluteTarget leaves URLs, protocol-relative links and anchors alone', () => {
  for (const target of ['https://example.com', 'http://x', 'mailto:a@b', '//cdn/x', '#install']) {
    assert.equal(isAbsoluteTarget(target), true, target)
  }
  for (const target of ['../../CHANGELOG.md', './TEMPLATE.md', 'scripts/x.mjs']) {
    assert.equal(isAbsoluteTarget(target), false, target)
  }
})

test('a relative link becomes a blob URL on the release tag', () => {
  const expanded = expandLinks('[CHANGELOG.md](../../CHANGELOG.md)', options)
  assert.equal(expanded, '[CHANGELOG.md](https://github.com/fishdivinity/dsh-local-search/blob/v0.2.0/CHANGELOG.md)')
})

test('a same-directory link resolves against the notes directory', () => {
  const expanded = expandLinks('[template](./TEMPLATE.md)', options)
  assert.equal(expanded, '[template](https://github.com/fishdivinity/dsh-local-search/blob/v0.2.0/docs/releases/TEMPLATE.md)')
})

test('a fragment survives expansion and absolute links are untouched', () => {
  const source = '[a](../architecture.md#config-page) and [b](https://example.com) and [c](#highlights)'
  const expanded = expandLinks(source, options)
  assert.match(expanded, /docs\/architecture\.md#config-page/)
  assert.match(expanded, /\[b\]\(https:\/\/example\.com\)/)
  assert.match(expanded, /\[c\]\(#highlights\)/)
})

test('images are expanded too', () => {
  const expanded = expandLinks('![x](../../icon.svg)', options)
  assert.equal(expanded, '![x](https://github.com/fishdivinity/dsh-local-search/blob/v0.2.0/icon.svg)')
})

test('a link that escapes the repository is refused instead of published broken', () => {
  assert.throws(() => expandLinks('[x](../../../outside.md)', options), /escapes the repository/)
})

test('a link pinned to main is refused: the tag is what stays put', () => {
  const pinned = '[CHANGELOG.md](https://github.com/fishdivinity/dsh-local-search/blob/main/CHANGELOG.md)'
  assert.throws(() => assertPinnedToTag(pinned, 'v0.3.0'), /not main/)
  // 指向 tag 的链接照旧放行。
  assert.doesNotThrow(() => assertPinnedToTag('[x](https://github.com/o/r/blob/v0.3.0/x.md)', 'v0.3.0'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const HEADER_LIMIT = 10
const BLOCK_LIMIT = 10

function walk(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

const shipped = [
  ...['lib', 'test', 'scripts', 'docs'].flatMap((directory) => walk(join(root, directory))),
  ...['README.md', 'README-zh.md', 'CONTRIBUTING.md', 'llms.txt'].map((name) => join(root, name)),
].filter((file) => /\.(js|mjs|md|txt)$/.test(file))

/** 一行算注释：以 `*`、`/*` 或 `//` 开头（代码行尾的注释不算，它跟着代码走）。 */
function isComment(line) {
  return /^\s*(\*|\/\*|\/\/)/.test(line)
}

test('shipped files never point outside the repository', () => {
  const hits = []
  for (const file of shipped) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      // 本地草稿目录不在仓库里：链接或路径形式都算，读者点不开它。
      if (/(^|[^a-z])notes[\\/]/.test(line)) hits.push(`${relative(root, file)}:${index + 1}`)
    })
  }
  assert.deepEqual(hits, [], 'these comments point at a directory that is not in the repository')
})

test('comment blocks stay inside the limits docs/comments.md sets', () => {
  const oversized = []
  for (const file of shipped.filter((path) => /\.(js|mjs)$/.test(path))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    let block = []
    let seenCode = false
    const flush = () => {
      if (block.length === 0) return
      const typedef = block.some((entry) => entry.text.includes('@typedef'))
      const limit = seenCode ? BLOCK_LIMIT : HEADER_LIMIT
      if (!typedef && block.length > limit) {
        oversized.push(`${relative(root, file)}:${block[0].line} (${block.length} lines, limit ${limit})`)
      }
      block = []
    }
    lines.forEach((line, index) => {
      if (isComment(line)) block.push({ line: index + 1, text: line })
      else if (line.trim() !== '') {
        flush()
        seenCode = true
      }
    })
    flush()
  }
  assert.deepEqual(oversized, [], 'trim these blocks or move the detail into docs/')
})

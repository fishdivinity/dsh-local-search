#!/usr/bin/env node
/**
 * 把发布说明里的相对链接展开成 GitHub 绝对 URL。
 *
 * 仓库里那份保留 `../../CHANGELOG.md`：在 blob 页面上能解析，仓库改名搬家也不会失效。
 * Release 正文没有文件路径可供解析，同一段文字在那里就是 404。发版 workflow 跑这个
 * 脚本并发布它的输出，于是源文件保持可读，发布出去的那份保持可点。
 *
 * 用法：node scripts/expand-release-links.mjs <notes.md> <out.md>
 * 环境变量：GITHUB_REPOSITORY（`owner/repo`）、GITHUB_REF_NAME（`v0.2.0`）。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, posix } from 'node:path'

/** markdown 链接或图片里的 `<target>`，`title` 不参与匹配。 */
const LINK = /(!?\[[^\]]*\]\()([^)\s]+)(\))/g

/**
 * 目标是否已经自带前缀、不需要再改写。
 * @param target - markdown 里原样的目标
 * @returns 绝对 URL、协议相对 URL 与锚点都是 true
 */
export function isAbsoluteTarget(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)
}

/**
 * 把说明文件里的每个相对链接改写成 `blob/<tag>` URL。
 * @param source - markdown 文本
 * @param options.notesPath - 说明文件在仓库内的相对路径
 * @param options.repository - `owner/repo`
 * @param options.tag - 链接要解析到的发布 tag
 * @returns 改写后的 markdown
 */
export function expandLinks(source, { notesPath, repository, tag }) {
  const baseDirectory = posix.dirname(notesPath.split('\\').join('/'))
  const prefix = `https://github.com/${repository}/blob/${tag}/`
  return source.replace(LINK, (match, open, target, close) => {
    if (isAbsoluteTarget(target)) return match
    const [pathPart, fragment] = target.split('#')
    const resolved = normalize(join(baseDirectory, pathPart)).split('\\').join('/')
    if (resolved.startsWith('..')) {
      throw new Error(`release notes link escapes the repository: ${target}`)
    }
    const suffix = fragment === undefined ? '' : `#${fragment}`
    return `${open}${prefix}${resolved}${suffix}${close}`
  })
}

/**
 * 发布正文里的链接必须钉在自己的 tag 上：`main` 会往前走（CHANGELOG 会在那儿裁切），
 * tag 不会。手写的 `blob/main` 当场拦下，而不是等读者点进去发现那一版不见了。
 * @param markdown - 展开后的正文
 * @param tag - 正在发布的 tag
 */
export function assertPinnedToTag(markdown, tag) {
  const moving = markdown.match(/\/(blob|tree)\/main\//g) ?? []
  if (moving.length > 0) {
    throw new Error(`release links must point at ${tag}, not main: ${moving.join(', ')}`)
  }
}

function main() {
  const [notesPath, outPath] = process.argv.slice(2)
  const repository = process.env.GITHUB_REPOSITORY
  const tag = process.env.GITHUB_REF_NAME
  if (notesPath === undefined || outPath === undefined) {
    throw new Error('usage: node scripts/expand-release-links.mjs <notes.md> <out.md>')
  }
  if (repository === undefined || tag === undefined) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_REF_NAME must be set')
  }
  const expanded = expandLinks(readFileSync(notesPath, 'utf8'), { notesPath, repository, tag })
  const remaining = expanded.match(LINK)?.filter((match) => {
    const target = /\]\(([^)\s]+)\)/.exec(match)?.[1] ?? ''
    return target !== '' && !isAbsoluteTarget(target)
  })
  if (remaining !== undefined && remaining.length > 0) {
    throw new Error(`relative links survived expansion: ${remaining.join(', ')}`)
  }
  assertPinnedToTag(expanded, tag)
  writeFileSync(outPath, expanded)
  console.log(`expanded release links: ${notesPath} -> ${outPath}`)
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main()
}

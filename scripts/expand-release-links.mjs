#!/usr/bin/env node
/**
 * Expand relative links in a release-notes file into absolute GitHub URLs.
 *
 * The repository copy keeps `../../CHANGELOG.md`, which resolves on a blob page
 * and stays correct if the repository moves. A Release body has no file path to
 * resolve against, so the same text 404s there. The release workflow runs this
 * script and publishes its output, so one source stays readable and the other
 * stays clickable.
 *
 * Usage: node scripts/expand-release-links.mjs <notes.md> <out.md>
 * Environment: GITHUB_REPOSITORY (`owner/repo`), GITHUB_REF_NAME (`v0.2.0`).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, posix } from 'node:path'

/** `<target>` of a markdown link or image, leaving titles untouched. */
const LINK = /(!?\[[^\]]*\]\()([^)\s]+)(\))/g

/**
 * Whether a link target already stands on its own.
 * @param target - the raw markdown target
 * @returns true for an absolute URL, a protocol-relative URL, or an anchor
 */
export function isAbsoluteTarget(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)
}

/**
 * Rewrite every relative link in a notes file to a `blob/<tag>` URL.
 * @param source - the markdown text
 * @param options.notesPath - repo-relative path of the notes file
 * @param options.repository - `owner/repo`
 * @param options.tag - the release tag the links should resolve against
 * @returns the rewritten markdown
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
  writeFileSync(outPath, expanded)
  console.log(`expanded release links: ${notesPath} -> ${outPath}`)
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main()
}

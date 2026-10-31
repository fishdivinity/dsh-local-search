#!/usr/bin/env node
/**
 * 扫描仓库里被跟踪的文件，找出不该公开的本机信息。
 *
 * 本机的用户名、主机名、个人工作目录这类信息，一旦进了提交就会永久留在历史里；
 * 与其每次发版前手工 grep，不如让规则固定下来、在 CI 里跑。
 * 规则不写死本机名字，而是运行时从 os 取，避免扫描脚本自己变成泄露源。
 *
 * 用法：node scripts/privacy-scan.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { hostname, userInfo } from 'node:os'

/** 不扫描的目录：第三方依赖、git 内部、私有笔记、临时缓存。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.npm-cache', 'notes', 'dist', 'coverage'])

/** 只扫描这些后缀，二进制与锁文件跳过。 */
const TEXT_EXTENSIONS = new Set(['', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.svg', '.txt'])

/**
 * 机器无关的硬规则：[名称, 正则, 说明]。
 *
 * 路径分隔符两种都认：审查报告与 issue 链接里的盘符路径常用正斜杠，只认反斜杠会漏。
 */
const RULES = [
  ['personal-directory', /[A-Z]:[\\/]+(Work|Personal|Personal_files)\b/i, '个人目录，换成中立的路径'],
  ['windows-user-path', /[A-Z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/i, '某个人的用户目录'],
  ['github-token', /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, 'GitHub 凭据'],
  ['npm-token', /npm_[A-Za-z0-9]{20,}/, 'npm 凭据'],
  ['api-key', /sk-[A-Za-z0-9]{20,}/, 'API key'],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥'],
]

/**
 * 按规则检查一段文本。
 * @param {string} text - 文件内容
 * @param {{userName?: string, hostName?: string}} machine - 本机身份，用于生成动态规则
 * @returns {Array<{line: number, rule: string, text: string}>} 命中项
 */
export function scanText(text, machine = {}) {
  const findings = []
  const dynamic = []
  if (machine.userName && machine.userName.length >= 3) {
    dynamic.push(['local-user', new RegExp(`\\b${escape(machine.userName)}\\b`, 'i'), '本机用户名'])
  }
  if (machine.hostName && machine.hostName.length >= 4) {
    dynamic.push(['local-host', new RegExp(`\\b${escape(machine.hostName)}\\b`, 'i'), '本机主机名'])
  }
  const rules = [...RULES, ...dynamic]
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [rule, pattern, why] of rules) {
      if (pattern.test(line)) findings.push({ line: index + 1, rule, text: `${why}：${line.trim().slice(0, 120)}` })
    }
  })
  return findings
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 递归列出要扫描的文本文件，跳过 SKIP_DIRS 与非文本后缀。 */
function trackedFiles(root = process.cwd()) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name))
        continue
      }
      const path = join(dir, entry.name)
      const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : ''
      if (!TEXT_EXTENSIONS.has(extension.toLowerCase())) continue
      try {
        if (statSync(path).size <= 512 * 1024) found.push(path)
      } catch {
        // 读不到就跳过，扫描不是审计。
      }
    }
  }
  walk(root)
  return found
}

function main() {
  const machine = { userName: userInfo().username, hostName: hostname() }
  let hits = 0
  for (const path of trackedFiles()) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const finding of scanText(text, machine)) {
      hits += 1
      console.log(`${relative(process.cwd(), path)}:${finding.line}  [${finding.rule}]  ${finding.text}`)
    }
  }
  if (hits > 0) {
    console.error(`\n发现 ${hits} 处本机信息；真实路径请放进 test/fixtures/local.json（已在 .gitignore）。`)
    process.exit(1)
  }
  console.log('隐私扫描通过：没有本机路径、用户名、主机名或凭据。')
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main()
}

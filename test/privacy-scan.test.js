import test from 'node:test'
import assert from 'node:assert/strict'
import { scanText } from '../scripts/privacy-scan.mjs'

const machine = { userName: 'sampleuser', hostName: 'SAMPLE-PC' }

// 夹具在运行时拼出来：源码里就不出现会被扫描器命中的字面量。
const workPath = ['D:', 'Work', 'company', 'a.docx'].join('\\')
const userPath = ['C:', 'Users', 'someone', 'x.txt'].join('\\')
const token = (prefix) => `${prefix}${'a'.repeat(24)}`

test('项目盘上的个人目录会被抓出来', () => {
  const findings = scanText(`见 ${workPath} 的说明`, machine)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, 'personal-directory')
})

test('正斜杠写法同样会被抓出来', () => {
  // 审查报告与 issue 里的链接常带正斜杠盘符路径，只认反斜杠会漏（字面量在运行时拼，源码里不出现）。
  const forwardWork = ['D:', 'Work', 'company', 'a.docx'].join('/')
  assert.equal(scanText(`见 ${forwardWork}`, machine)[0].rule, 'personal-directory')
  const forwardUser = ['C:', 'Users', 'someone', 'x.txt'].join('/')
  assert.equal(scanText(forwardUser, machine)[0].rule, 'windows-user-path')
})

test('用户目录与凭据都会被抓出来', () => {
  assert.equal(scanText(userPath, machine)[0].rule, 'windows-user-path')
  assert.equal(scanText(token('ghp_'), machine)[0].rule, 'github-token')
  assert.equal(scanText(token('npm_'), machine)[0].rule, 'npm-token')
  assert.equal(scanText('-----BEGIN OPENSSH ' + 'PRIVATE KEY-----', machine)[0].rule, 'private-key')
})

test('本机用户名与主机名来自运行时，不写死在脚本里', () => {
  assert.equal(scanText('作者是 sampleuser', machine)[0].rule, 'local-user')
  assert.equal(scanText('跑在 SAMPLE-PC 上', machine)[0].rule, 'local-host')
  // 换一台机器，旧名字不再命中。
  assert.deepEqual(scanText('作者是 sampleuser', { userName: 'other', hostName: 'OTHER-PC' }), [])
})

test('中立的示例路径与普通文档不会误报', () => {
  assert.deepEqual(scanText(['见 D:', 'Alpha', 'a.docx 与 C:', 'Program Files', 'Everything'].join('\\'), machine), [])
  assert.deepEqual(scanText('配置页 -> Plugins -> Official plugins', machine), [])
})

test('行号从 1 开始，便于直接定位', () => {
  const findings = scanText(`第一行\n第二行 ${workPath}`, machine)
  assert.equal(findings[0].line, 2)
})

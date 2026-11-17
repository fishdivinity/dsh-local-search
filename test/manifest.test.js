import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const manifest = JSON.parse(read('package.json'))

/** 同一区间要出现在这几个 DSH peer 上：改一处就得六处一起改，否则安装器与文档会各说各话。 */
const DSH_PEERS = [
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-working-directory',
]

test('the DSH range is one value in the manifest, its peers and both READMEs', () => {
  const range = manifest.engines.dsh
  // 下界是承诺：0.2.1 的用户要能装。改它等于抬下限，得先有「旧 DSH 的最后可用版本」。
  assert.match(range, /^>=0\.2\.1-0 </)
  // 上界要挡 0.3 的预发布；DSH 用 includePrerelease 判定，`<0.3.0` 挡不住。
  assert.ok(range.endsWith('-0'), 'the upper bound must be a prerelease bound')
  for (const peer of DSH_PEERS) {
    assert.equal(manifest.peerDependencies[peer], range, `${peer} must carry the same range`)
  }
  for (const file of ['README.md', 'README-zh.md']) {
    assert.ok(read(file).includes(`\`${range}\``), `${file} must name the shipped range`)
  }
})

test('the README states the dependency policy the toolchain now assumes', () => {
  // 「零依赖」收窄成「运行时零依赖」之后，这句话是 P1-4 的前提：CI 会装 devDependencies。
  // 改回去（或删掉后半句）这里就红，免得下一个人以为仓库还是零安装。
  const readme = read('README.md')
  assert.ok(readme.includes('No runtime dependencies'), 'README must keep the runtime-only promise')
  assert.ok(readme.includes('development-only dependencies'), 'README must allow development dependencies')
  assert.ok(readme.includes('docs/troubleshooting.md'), 'README must keep the pointer to the code table')
})

test('the troubleshooting page keeps the recovery path out of safe mode', () => {
  // 桌面端的「禁用所有插件」会把整个 profile patch 改名备份；恢复步骤只写在这一页，
  // 删掉它等于让用户自己从备份里猜。
  const page = read('docs/troubleshooting.md')
  assert.match(page, /^## The plugin row is gone after safe mode$/m)
  assert.ok(page.includes('cordis.patch.yml.bak-'), 'the recovery must name the backup file')
})

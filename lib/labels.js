/**
 * 后端在工具输出与诊断文本里的显示名。
 *
 * 一处定义：状态工具（`lib/format.js`）与诊断文本（`lib/diagnose.js`）都从这里取，加后端点名
 * 只需要加一条。配置页那份产品名在客户端字典里（`engine.<name>`，`lib/client.js`）——浏览器
 * 半边不能 import 这个模块，所以它只能各持一份，由 key-parity 测试对齐。
 */

const LABELS = new Map([
  ['everything', 'Everything'],
  ['anytxt', 'Anytxt'],
])

/**
 * 后端的显示名；没登记过的用注册表里的名字。
 * @param {string} name - 注册表里的后端名
 * @returns {string} 显示名
 */
export function engineLabel(name) {
  return LABELS.get(name) ?? String(name)
}

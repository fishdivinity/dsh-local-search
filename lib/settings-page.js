/**
 * 声明「本插件自带配置页」，让 Settings 服务不要再按 schema 生成第二个表单。
 *
 * 0.2.1 的 settings 没有 `configure`，`ctx.fiber` 也不一定暴露；缺一样就静默跳过，
 * 配置页与工具都不受影响。
 * @param ctx - 插件的 Cordis 上下文（取 `fiber`）
 * @param settingsCtx - `ctx.inject(['settings'])` 的子上下文
 * @returns 注销函数；没有可声明的东西时为 undefined
 */
export function declareOwnSettingsPage(ctx, settingsCtx) {
  const settings = settingsCtx.get('settings')
  if (typeof settings?.configure !== 'function') return undefined
  const fiber = ctx.fiber
  if (fiber === undefined) return undefined
  return settings.configure({ auto: false }, fiber)
}

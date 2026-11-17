/**
 * 五个模型工具的清单。
 *
 * 注册时固定截止时间与描述里的默认值；一次调用真正用到的一切都是每次现读的，所以配置页上的保存
 * 对下一次调用生效，而不是对下一次重载生效。每个工具自己一个文件（`lib/tools/*.js`），这里只
 * 拼清单——改一个工具不必滚过另外四个。
 */

import { readConfig } from './config.js'
import { engineNames } from './engines.js'
import { createContentTool } from './tools/content.js'
import { createFilesTool } from './tools/files.js'
import { createFragmentsTool } from './tools/fragments.js'
import { createReadTool } from './tools/read.js'
import { createStatusTool } from './tools/status.js'

/**
 * 构建并注册五个面向模型的工具。
 * @param {import('./tools/shared.js').ToolContext} ctx
 * @param {object} config
 * @returns {Array<import('@deepseek-ai/dsh-tools').ToolDefinition>} 五个工具，按清单顺序
 */
export function createTools(ctx, config) {
  const initial = readConfig(config)
  const names = engineNames()
  const deps = { ctx, config, initial, names }
  return [
    createFilesTool(deps),
    createContentTool(deps),
    createFragmentsTool(deps),
    createReadTool(deps),
    createStatusTool(deps),
  ]
}

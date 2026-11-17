/**
 * 只给 `tsc --checkJs` 看的声明，运行时不读它：`lib/client.js` 是 classic script（没有 import/export），
 * 它用到的两个名字在环境类型里都不存在——宿主的 `window.__ModuleLoader__`，以及宿主模块表给的
 * `require('react')`（react 只声明成 peer，本包不装它，也就没有 @types/react）。
 *
 * 放在 `lib/` 外面：`files` 收整个 `lib/`，而这份声明没有任何代码 import，不必随包发。
 */

interface Window {
  /** 宿主的模块表：客户端 bundle 按 lazy-CJS 工厂格式把自己登记进去，工厂拿到的就是那个 `require`。 */
  __ModuleLoader__: {
    load(options: { id: string; factory: (require: (name: string) => any) => void }): void
  }
}

/**
 * react 由宿主提供，没有类型包。空声明的模块整份按 any 处理：这里要的是让 tsc 别去找不存在的
 * 模块与 @types/react，不是给页面一个带类型的 React。
 */
declare module 'react'

<div align="center">

<img src="https://raw.githubusercontent.com/fishdivinity/dsh-local-search/main/icon.svg" width="96" alt="Local Search 图标">

# 本地搜索（DeepSeek Harness）

**把整台机器的文件名与文档内容交给五个只读工具——让模型去搜你的盘，而不是猜一个路径。**

[![npm version](https://img.shields.io/npm/v/@fishdivinity/dsh-local-search)](https://www.npmjs.com/package/@fishdivinity/dsh-local-search)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-blue)](#前提)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--0%20%3C0.3.0-blue)](#前提)
[![CI](https://img.shields.io/github/actions/workflow/status/fishdivinity/dsh-local-search/ci.yml?branch=main&label=CI)](https://github.com/fishdivinity/dsh-local-search/actions)
[![GitHub stars](https://img.shields.io/github/stars/fishdivinity/dsh-local-search?style=flat)](https://github.com/fishdivinity/dsh-local-search)

[English](README.md) · [简体中文](README-zh.md) · [安装](#安装) · [配置](#配置) · [工具](#工具) · [安全](#安全与限制)

</div>

## 为什么有这个插件

一次会话只看得到一个目录。`grep` 和 `glob` 在目录里很快，出了目录就瞎：要用的文件在别处时，模型不是猜一个路径，就是停下来问你——于是查文件的活又回到你手上，还得另开一个窗口，把对话晾在那儿。

「搜一下」其实不是贵的部分。挑哪条命中、打开文档、读该读的那段、把两份放在一起比、最后说清结论出自哪里——这才是。而这些正好是模型擅长的，只要它够得着索引。

这个插件把两个索引都接进来：`es.exe` 查 Everything 索引到的**文件名**，Anytxt 读 PDF、DOCX、XLSX、PPTX、EPUB、RTF、TXT、MD 里的**正文**。整套能力只读——不写、不删、不重建索引、不做 OCR、不启动引擎。

## 什么时候用它

- **检索只是中间一步，不是目的。** 你要的是总结、对比、修一个错，而答案落在某份你指不出来的文件里。把这次查找还给自己，代价是一个窗口切换加一次粘贴。
- **你知道答案长什么样，不知道关键词。** 「跟那个供应商谈的价格条款」「上回这个报错的原因」。模型可以换五种说法、中英文各试一遍，读完命中再把原文和路径一起交回来。
- **答案横跨几份文件。** 「对比这两份合同的付款条款」「最近三次会议纪要里关于排期定了什么」。检索框给你一份命中列表，读和比才是你要交出去的那部分。
- **要成批处理。** 「把这 30 份合同的甲方列成一张表」——没有哪个搜索框能做这个。搜一次、逐份读、写表。
- **文件不是纯文本。** `grep` 打不开 PDF、`.docx` 或表格；要么正文从 Anytxt 过来，要么你自己粘。
- **结论得能追到出处。** 路径加片段能核对，一段听起来合理的解释不能。

## 目录

- [为什么有这个插件](#为什么有这个插件)
- [什么时候用它](#什么时候用它)
- [工具](#工具)
- [前提](#前提)
- [安装](#安装)
- [配置](#配置)
- [Scope](#scope)
- [引擎选择](#引擎选择)
- [错误码](#错误码)
- [安全与限制](#安全与限制)
- [已知限制](#已知限制)
- [给 AI 用的部分](#给-ai-用的部分)
- [开发](#开发)
- [许可证](#许可证)

## 工具

| 工具 | 引擎 | 用途 |
|---|---|---|
| `local_search_files` | Everything / `es.exe` | 文件名、路径、跨盘找文件 |
| `local_search_content` | Anytxt JSON-RPC | PDF/DOCX/XLSX/PPTX/EPUB/RTF/TXT/MD 内容 |
| `local_search_fragments` | Anytxt | 命中片段 |
| `local_search_read` | Anytxt | 抽取后的全文（截断） |
| `local_search_status` | 两者 | 检查引擎是否可用 |

## 前提

- Windows。
- DeepSeek Harness `>=0.2.1-0 <0.3.0`。
- Everything 正在运行，并安装 `es.exe`（voidtools 单独下载；插件会从 PATH/常见目录探测，也可配置 `files.everything.esPath`）。
- 内容检索需要 Anytxt Searcher 的 **GUI**（`ATGUI.exe`）在运行；JSON-RPC 服务在 GUI 进程里，只有 `ATService` 不够。

插件不打包 Everything、`es.exe` 或 Anytxt，需自行安装并遵守各自许可。

## 安装

```powershell
dsh plugin --profile desktop add @fishdivinity/dsh-local-search
```

npm 首发前可从 GitHub 安装：

```powershell
dsh plugin --profile desktop add github:fishdivinity/dsh-local-search
```

重启 profile 或新开会话，工具列表出现 5 个 `local_search_*` 工具。

## 配置

侧边栏 **Plugins** → **Official plugins** 组里的「本地搜索」卡片 → 插件自己的页面。这张卡和 GitHub 插件那张是同一个形态。保存后对下一次工具调用生效；离开页面丢弃未保存改动。描述下面那个**重置**会先把会清什么摆出来，确认后才清掉引擎与上限、按一次新的探测填回去；检索范围不动，因为那是你自己敲进去的路径。

页面按能力组织：「文件名检索」与「文件内容检索」各以一行后端选择器开头，选中后展开该后端的字段；「检索范围」与「上限」与后端无关，收在页尾。分节、后端列表、字段类型与硬上限都由 Host 的 `GET /dsh-local-search/api/describe` 给出，页面只负责渲染，新增后端不用改页面逻辑。

**测试连接**就放在 Anytxt 地址字段下面，测的是**输入框里当前的地址和 `es.exe` 路径**（不用先保存），同时把 Everything 一起探一遍：路径打错就直接说找不到文件，不会拿已保存的那个报「正常」。结果与修法在一个弹窗里，弹窗还能再测一次。某个引擎不可用时会给出它的官方下载页；本插件不打包、不下载、也不代替你安装这两个程序。

**保存前会先校验。** 只要这次保存动了地址或 `es.exe` 路径，页面就先把它们探一遍：不通过就不写，弹窗问你要不要「仍然保存」——那是你明知的例外，而不是默认结果；路径上没有文件、目录不存在、地址被拒这类硬错没有强行写入的出口。路径那一项 Host 只查「文件在不在」，绝不启动请求里指定的文件。路径字段与 Anytxt 地址都在**失焦时**先校验一次：不存在、把目录填成文件、地址不是本机，都会在字段下面标红，改掉就收回。

路径字段保存时会改成标准写法：`d:/alpha` 存成 `D:\alpha`（盘符大写、反斜杠、去掉末尾分隔符），`allRoots` 按分号逐项改；路径存在时还会按磁盘上的真实大小写写回（`d:/alpha` → `D:\Alpha`）。名字里的空格与中文不动——`D:\Alpha\我的项目\drawio a` 这样带空格的目录名照写就行，宿主按值传给 `es.exe` 与文件接口，不经过 shell。

首用只补一次就停：`files.everything.esPath` 或 `content.anytxt.url` 还空着时，插件探一次、把能应答的写进去，并在隐藏键 `autoConfigured` 里记下这次已经做过决定。之后你清空的字段会保持空着，不会再被自动填回去。

全部可选；row config 是整块替换，不会深合并。只有 `timeoutMs` 留在 profile 的 `cordis.patch.yml`：每个工具在注册时就固定截止时间，因此页面上不提供这个字段，免得出现“改了没反应”。

| 键 | 默认 | 说明 |
|---|---|---|
| `files.backend` | `everything` | `auto` 使用的文件名后端 |
| `files.everything.esPath` | 自动探测 | `es.exe` 绝对路径。顺序：配置值 → `ES_PATH` → 常见安装目录 → `where.exe` |
| `files.everything.esEncoding` | `gbk` | 解码 `es.exe` 输出的代码页；接受任意 `TextDecoder` 标签，页面上是 `gbk` / `utf-8` 二选一 |
| `content.backend` | `anytxt` | `auto` 使用的内容后端 |
| `content.anytxt.url` | `http://127.0.0.1:9920` | 本机 Anytxt JSON-RPC 地址（只接受 `127.0.0.1`、`localhost`、`[::1]`）；默认还会尝试 `:9921` |
| `scopes.workspaceRoot` | 会话默认目录 | `scope=workspace` 的根 |
| `scopes.workRoot` | 空 | `scope=work` 的根；使用前必须配置 |
| `scopes.personalRoot` | 空 | `scope=personal` 的根；使用前必须配置 |
| `scopes.allRoots` | `C:\` + 存在时的 `D:\` | Anytxt `scope=all` 的根，分号分隔；Everything 的 `all` 搜它索引的所有卷 |
| `limits.maxResults` | `20` | 默认结果上限；硬上限 100 |
| `limits.readMaxChars` | `8000` | `local_search_read` 默认窗口；硬上限 20,000 字符 |
| `timeoutMs` | `30000` | 单次调用超时预算；仅 profile YAML |

示例：

```yaml
- id: fishdivinity-local-search
  name: '@fishdivinity/dsh-local-search'
  config:
    scopes:
      workRoot: 'D:\Projects'
      personalRoot: 'D:\Documents'
    limits:
      maxResults: 50
```

0.2 的 profile 不用手改：启动时那九个扁平键（`esPath`、`esEncoding`、`anytxtUrl`、`workspaceRoot`、`workRoot`、`personalRoot`、`allRoots`、`maxResults`、`readMaxChars`）会搬进上面的嵌套结构并清掉旧键。settings 写不进去时（profile 被 home patch 覆盖）旧键留在原地，读取仍然认它。

## Scope

- `workspace`（默认）：会话工作目录。
- `work`：`scopes.workRoot`。
- `personal`：`scopes.personalRoot`。
- `all`：Anytxt 用 `scopes.allRoots`；Everything 搜所有已索引卷。

只有用户明确说“全盘/跨盘”时才用 `all`；`path` 参数可覆盖 `scope`。

## 引擎选择

`engine` 默认 `auto`，跟随该能力配置的后端：`local_search_files` 用 `files.backend`，`local_search_content` / `fragments` / `read` 用 `content.backend`。

- `local_search_files`：`auto` / `everything`。
- `local_search_content` / `fragments` / `read`：`auto` / `anytxt`。
- `local_search_status`：`auto` / `everything` / `anytxt`。

以后加引擎时工具名不变，只增加 `engine` 取值。内容结果同时带 `engine` 和自描述的 `ref`（如 `anytxt:123`）；把 `ref` 原样传给 `local_search_fragments` / `local_search_read`，`engine` 只作为校验用。

## 错误码

| code | 含义 |
|---|---|
| `EVERYTHING_ES_NOT_FOUND` | 找不到 `es.exe`；安装或配置 `files.everything.esPath` |
| `EVERYTHING_DOWN` | Everything 没运行/不可达 |
| `EVERYTHING_TIMEOUT` / `EVERYTHING_TOO_LARGE` | 查询太宽或太慢；缩小范围 |
| `ANYTXT_DOWN` | Anytxt GUI 没运行或 JSON-RPC 不可达 |
| `ANYTXT_TIMEOUT` / `ANYTXT_RPC` / `ANYTXT_HTTP` | Anytxt 侧查询/传输失败 |
| `ROOT_NOT_FOUND` / `SCOPE_NOT_CONFIGURED` / `INVALID_SCOPE` | 根目录/scope 配置问题 |
| `INVALID_ARGUMENT` | 空查询、非法 limit 等 |

搜到 `*_DOWN` 时回退 `grep`/`glob`，并说明已回退。

## 安全与限制

- **只读**：没有写、删、索引同步、OCR、导出、改设置等操作。
- `es.exe` 固定 argv，模型文本永远在 `--` 之后；`-export-*`、`-save-settings`、`-clear-settings`、`-exit`、`-reindex`、`-save-db`、run-count 不可达。
- Anytxt 只调 `Search` / `GetResult` / `GetFragmentAll` / `GetRawTextByFID`。
- 除本地 Anytxt 地址外不联网；结果有上限；`local_search_read` 截断。
- 插件以用户权限运行，能读用户能读的文件；默认 `scope=workspace`，不要无故全盘。

## 已知限制

- 仅 Windows。
- Everything 1.4 只索引元数据，不索引文件内容；内容检索靠 Anytxt。
- Anytxt 的 JSON-RPC 是本地非官方接口，GUI 版本可能变；插件对不可达/结构不符会明确报错。
- Anytxt 索引可能滞后；重要命中要用 `read`/原文件复核。
- 不自动启动 `ATGUI.exe`（启动会写索引），由用户手动控制。
- Anytxt 条款限个人/非商业使用；商用需单独授权。

## 给 AI 用的部分

只看得到一个目录、却被问到别处的文件时，应该去搜，而不是猜。把问题对到工具上：

| 你要问 | 用哪个工具 | 拿回什么 |
|---|---|---|
| 这个文件在哪？ | `local_search_files` | Everything 索引到的路径与名字 |
| 这份文档说了什么？ | `local_search_content` | Anytxt 抽出的正文里的命中行，每条带一个 `ref` |
| 具体是哪一段？ | `local_search_fragments` | 围绕某次命中的片段——把那条命中的 `ref` 原样传进去 |
| 把正文给我 | `local_search_read` | 单个文件抽出的纯文本，有截断上限 |
| 引擎到底在不在？ | `local_search_status` | 各引擎可达性，报「没有结果」之前先问它 |

- `scope` 默认 `workspace`（会话目录）；`work`、`personal` 是配置过的根；`all` 跨盘，只在明确要全局检索时用。`path` 覆盖 `scope`。
- 内容命中里的 `ref`（`anytxt:123`）原样传回去；`engine` 用来核对，不是选择器。
- `EVERYTHING_DOWN` / `ANYTXT_DOWN` 表示引擎没在跑——退回 `grep`/`glob` 并说明你退回了。引擎不可用不等于「没有这个文件」。
- 结果有条数上限（`limits.maxResults`，硬上限 100；`local_search_read` 两万字符）。收窄查询，别靠分页。
- 每个失败都带上面的稳定错误码，报码比报文案有用。
- 仅 Windows，两个引擎都要另装：文件名结果只覆盖 Everything 索引过的，正文结果只覆盖 Anytxt 索引过的。

这一节的机器可读版在 [`llms.txt`](llms.txt)。能被搜到这些词：本地搜索、Everything、`es.exe`、Anytxt、全文检索、PDF / Word / Excel / PPT / EPUB 正文、跨盘搜索、工作区之外的文件名。

## 开发

无运行时依赖，测试用 Node 内置 test runner：

```powershell
npm test
npm run check
npm run pack:check
```

引擎与配置模块（`lib/everything.js`、`lib/anytxt.js`、`lib/roots.js`、`lib/format.js`、`lib/config.js`）不依赖 DSH runtime，可在普通 Node 下测试。`lib/client.js` 是随包发布的浏览器半：直接按客户端模块系统的 lazy-CJS factory 格式手写成最终产物，没有构建步骤。架构与扩展见 [`docs/architecture.md`](docs/architecture.md)、[`docs/extending-engines.md`](docs/extending-engines.md)；改配置形状前先读 [`docs/config-migration.md`](docs/config-migration.md)。

## Changelog

见 [CHANGELOG.md](CHANGELOG.md)（中文）或 [CHANGELOG.en.md](CHANGELOG.en.md)（英文）。它们保留在仓库里；npm tarball 只带运行时文件、README、LICENSE、locale 和 icon。

## 许可证

MIT。Everything 与 Anytxt 是独立产品，各有自己的许可与商标；本项目与 voidtools、CBEWIN 无隶属关系。

# Changelog

## 0.3.0 — 2026-10-29

**配置键迁移**：`esPath`、`esEncoding`、`anytxtUrl`、`workspaceRoot`、`workRoot`、`personalRoot`、`allRoots`、`maxResults`、`readMaxChars` 从顶层搬进 `files.*` / `content.*` / `scopes.*` / `limits.*`。启动时把旧键读进新结构并清掉旧键；写入被 home patch 覆盖时旧键保留，读侧继续认它。0.2 的 profile 不需要手改。

- `search`: `engine` 参数的 `auto` 改为跟随配置的 `files.backend` / `content.backend`，不再是「注册表里第一个后端」。
- `page`: 配置页改成能力优先——两节是「文件名检索」「文件内容检索」，节内先选后端（产品名），选中后展开该后端字段；检索范围与上限两个与后端无关的节留在页尾。
- `page`: 新增 `GET /dsh-local-search/api/describe`，后端列表、每个后端的字段、类型、choices 和硬上限由 Host 给；页面只按它渲染，新增后端不再改页面逻辑。
- `page`: 页面不再自带一份硬上限，`maxResults` / `readMaxChars` 的上限来自 describe，与 schema 同源。
- `engines`: 首用自动配置——探测到的 `es.exe` 绝对路径、以及 Anytxt 实际应答的地址（与默认不同才写，`:9921` 上的安装会被记下来），写进仍为空的用户层字段；配置齐全时不探测，所以没有额外启动成本。写盘不留可见记录；有引擎不可用时在 `shell.overlay` 提示一次（按浏览器会话记一次，primitives 没有 `Toast` 的部署不提示）。
- `engines`: 首用自动配置只在一次启动里做决定，并把 `autoConfigured`（隐藏键）一起落盘；此后清空的字段保持空着，不会被自动填回去。启动配置改到 Loader 安顿好之后执行，否则 `settings.describe()` 还看不到本行，迁移会被静默跳过。
- `page`: 保存前先校验——改动地址、`es.exe` 路径或检索范围里的目录时，页面先问一次 Host。不通过就不写，改由弹窗问一次「仍然保存」；路径上没有文件、目录不存在、地址被拒这类硬错没有强行写入的出口。Host 只查存在性，不启动请求里指定的文件（`?esPath=` / `?dir=`，越界即 `ES_PATH_REJECTED` / `DIR_REJECTED`）。
- `page`: 去掉逐字段的「本页设置」徽标与重置按钮，改成一个**重置**入口（描述正下方，实心）：点开弹窗说清会清什么，确认后一次原子写入——清掉引擎与上限、探一次、把 `esPath` 与 Anytxt 地址按探测结果填回去（检索范围保留）。做法由 `describe.reset` 描述，页面不写死清哪些字段。
- `page`: 列数改由宽度查询决定（`matchMedia('(min-width: 656px)')`）：656px 以上两列、以下一列，整块上限 1100px，所以全屏仍是原来的 2×542，约 700px 的容器也排两列；单列时每格上限 560px，不会横贯整屏。
- `page`: 重置、被拦下的保存、测试连接三处都走 primitives 的 `Modal`——它自己 portal 到 `document.body`，Esc、Tab 焦点陷阱与关闭后的焦点归还都由壳子兜住，本包仍然不发 CSS。部署里没有 `Modal` 时退回页内提示（和 `Toast` 同一条规矩）。提示语压成一行，红色用 `--dsw-alias-state-error-primary`，链接用 `--dsw-alias-link`——原来写的 `--dsw-alias-state-warning-primary` 这个 token 不存在、`--dsw-alias-brand-primary` 是近中性品牌色。
- `page`: 保存前把带路径语义的字段改写成标准写法——盘符大写、只用 `\`、折叠重复与去掉末尾分隔符，`allRoots` 按 `;` 逐项改写；`d:/alpha/` 写成 `D:\alpha`。只认 `D:\` 与 `\\server` 两种开头，POSIX 写法不碰；名字里的空格与中文原样保留（`drawio a` 这种目录名照写，宿主按值传，不经过 shell）。校验通过后 `status` 路由再把磁盘上的真实写法回给页面（`d:/alpha` → `D:\Alpha`），落盘的是这一份。
- `page`: 三个弹窗的文案按「标题说是什么事，正文只给增量」重写：重置是「重置 / 按探测结果重新填入；检索范围保留，其余恢复默认。」（取消 / 重置）；硬错是「无法保存 / <原因>。」（只有关闭）；引擎不可用是「仍要保存？/ <原因>。」（取消 / 仍然保存）；测试连接正文是一个无序列表，一行一个引擎（通过的带版本），失败那行下面挂自己的修法，不再有合成的一段指引、错误码和地址行，字号跟弹窗正文走。文案里不出现引擎名与字段名，后端或清空列表变了也不用改文案。页内那句「…，没有写入。」只留给没有 `Modal` 的部署。
- `page`: **测试连接现在会校验输入框里的 `es.exe` 路径**——把这个草稿一起交给 Host，路径打错时弹窗直接说「es.exe 路径上找不到文件」，而不是拿已保存（或自动找到）的那个报「正常」。Host 仍然只查存在性，绝不运行请求里给出的路径。
- `page`: 路径字段与 Anytxt 地址都改在**失焦时**校验（路径问 Host 的 `?checkOnly=1`，跳过引擎探测；地址在本地判形状，不发请求），边打字不再跳红字。不存在、填反了、地址不是本机，都把字段说明换成红字，值一改就收回。
- `route`: 草稿校验分清「不存在」和「填反了」——目录位置填了文件是 `DIR_NOT_DIRECTORY`，`es.exe` 位置填了目录是 `ES_PATH_NOT_FILE`，页面据此说「这里要填目录，不是文件」，而不是含糊的「不存在」。
- `page`: 字段说明改成一句话说清「填什么」：`完整目录，例如 D:\Alpha；留空跟随当前工作目录。`、`本机地址，例如 http://127.0.0.1:9920。`——不再出现 `scope=workspace` 这种内部叫法，也不再长篇解释 `TextDecoder` 标签。
- `page`: 底部「超时只在 profile 的 YAML 里配」那段压成一句。
- `page`: 测试连接的三种状态对齐壳子的弹窗版式：单行结论（找不到文件 / 地址被拒 / 请求失败 / 测试中）走 `description`，和「重置」「仍要保存？」的正文同一个位置、同一个字号；成功时那份列表外面套一层 `marginTop:-20px`，抵掉 `.body` 固定多的 20px 上边距，标题下面不再空一块。修法仍是 12px 灰。
- `config`: 迁移改成一张「退役路径表」（`lib/config.js` 的 `RETIRED_PATHS`）：读取兜底、schema 里的隐藏旧键、启动迁移都只读这一份，按发布顺序累积。因此 0.1 或 0.2 直装当前版本走的是同一条链，不需要中间版本存在过；规则与加一条迁移的步骤见 `docs/config-migration.md`。迁移**只搬用户层里真的写过的旧键**——schema 给退役路径也带默认值，按配置判断会把这几个默认值写进 profile，还会让首用自动配置以为地址已设、丢掉 `:9921` 的发现。
- `page`: 清空一个字段现在等于 `unset`（回落到 profile 层或默认值），不再写一个空覆盖值把 profile 挡住；整数框清空后也能直接保存。
- `config`: 启动写回撞上并发修改（例如探测那一秒里有人在页面点了保存）会重读 revision 再试一次；写回失败的原因会进 describe 的 `autoconfig.error`，不再只落一条看不见的日志。已知限制：在市场里**禁用后再启用**插件时，宿主会吞掉这次写入，配置要等下次正常启动才补齐；启用/禁用之后重启一次即可。
- `docs`: 注释改中文（`lib/*.js`、`test/*.test.js`、`scripts/*.mjs`）；报错文案、日志和 schema 的 `description` 仍是英文。
- `privacy`: 新增 `npm run privacy`；CI 在测试之外单独跑，提交前也要跑。真实场景的路径进 `test/fixtures/local.*`，该文件已在 `.gitignore`。
- `release`: 发布说明改为中文在前、英文在后，模板是 `docs/releases/TEMPLATE.md`。
- `test`: 新增 `test/describe.test.js` 与 `test/bootstrap.test.js`；`test/config.test.js`、`test/client.test.js` 按嵌套结构重写，`test/route.test.js` 补上 describe 路由。`test/client.test.js` 现在比对 describe 给出的每个字典键，并用一套会真的重渲染的 hooks 驱动页面——静态的 `useState` 桩看不出「effect 改了状态、那个状态又在依赖数组里」这类死锁。

## 0.2.1 — 2026-10-29

- `es.exe` exiting 1 with an empty stdout is now `EVERYTHING_DOWN` instead of an empty result: es.exe uses that code both for "nothing matched" and for a dead connection, so a closed Everything window no longer reads as "no files found" while the page's Test control says the engine is down.
- A capped page whose hits were all in `$RECYCLE.BIN` / `System Volume Information` reports "no files found in the returned window (the result set was capped)" instead of a flat "No files found"; the cap is measured on what es.exe returned, before the index filter.
- `local_search_status` reports a cancelled probe as `ABORTED — <CODE>` rather than `DOWN`, so cancellation no longer points at the engine.
- `scope=all` drops roots nested inside another root: AnyTxt is queried once per tree, so overlapping roots no longer double the "x of y" total or flip `truncated` early.
- The configuration page's Test control names the missing link: the probe route reports whether Everything is not installed, installed but not running, or missing `es.exe`, and the page shows the matching one-line fix (the model-facing status keeps its two stable codes). When the install check itself cannot run, it reports `unknown` and keeps the generic hint instead of claiming Everything is absent.
- The hard caps live in `lib/limits.js`; a test now pins the page's copies of the caps and the loopback host list to the Host's own rules.
- The routing prompt is shorter: 447 characters / 61 words to 227 / 28, with the same four decisions, since each tool's own description already carries its purpose.
- Release bodies expand relative links (`../../CHANGELOG.md`) to `blob/<tag>/` URLs when the workflow publishes them, so the repository copy stays readable and the published page stays clickable.

## 0.2.0 — 2026-10-28

- Configuration page as a card in the Plugins page's **Official plugins** group (`plugins.item`, the same shape dsh-github contributes); the card id is the row id, which is what the page resolves the form with.
- Nine fields are now editable there and apply to the next tool call: `esPath`, `esEncoding`, `anytxtUrl`, `workspaceRoot`, `workRoot`, `personalRoot`, `allRoots`, `maxResults`, `readMaxChars`.
- The page lays fields out the way the official settings pages do: sections with a small heading over a responsive field grid, instead of one field per row. The grid seats two columns from 460px up (four path fields read as two rows), and each field sits in a plain wrapper so the field primitive's `.field + .field` separator does not draw inside a cell.
- `esEncoding` is a two-choice control on the page (`gbk` / `utf-8`); the schema keeps accepting any `TextDecoder` label, so a 0.1 profile that wrote `utf8` still activates and the page shows the matching segment.
- New multi-colour `icon.svg` (gradients, no `currentColor`), wired through `package.json` `icon` and the `./icon` export. It shows on the bundle card in Installed plugins, on npm, and in the README; the Official plugins card keeps the page's own default artwork, because that slot resolves icons from a hard-coded map of the four built-in pages.
- `anytxtUrl` must be local (`127.0.0.1`, `localhost`, `[::1]`): both indexes describe this machine, so a remote endpoint would answer with paths that do not resolve here. The rule is enforced by the content engine (`ANYTXT_ENDPOINT_REMOTE`), not at activation, so a 0.1 profile pointing elsewhere still loads and only content search reports it; `maxResults` / `readMaxChars` are range-checked in the schema, so a page write can no longer persist an out-of-range value.
- **Test connection** sits under the Anytxt endpoint, probes the address in the field (no save needed) together with Everything, and answers in one line, through the read-only Host route `GET /dsh-local-search/api/status`; `lib/probe.js` runs the same probe for `local_search_status`. The route refuses cross-site requests and accepts a draft only as a loopback URL; an AnyTXT redirect is refused instead of re-POSTing off-machine. A failing engine links to its official download page — the package never bundles, downloads, or installs either product.
- `lib/config.js` reads a plain snapshot per call, so a saved value is not frozen at activation.
- `timeoutMs` stays profile-YAML only: each tool fixes its deadline at registration.
- The page renders from the shipped UI primitives with no CSS of its own, so UI skins restyle it unchanged.
- New `test/config.test.js`, `test/route.test.js`, and `test/client.test.js`.

## 0.1.0 — 2026-10-28

- Initial native Host plugin.
- `local_search_files` via Everything (`es.exe`), with auto-detection and GBK decoding.
- `local_search_content`, `local_search_fragments`, `local_search_read` via Anytxt JSON-RPC.
- `local_search_status` for both engines.
- `workspace` / `work` / `personal` / `all` scopes; `engine: auto|everything|anytxt`.
- Read-only boundaries: fixed `es.exe` argv, no Anytxt write methods, bounded results.

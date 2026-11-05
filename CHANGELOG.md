# Changelog

本文件中文；英文全量在 [CHANGELOG.en.md](CHANGELOG.en.md)。0.2.1 及更早的条目保留发布时的英文原文，0.3.0 起两边各写一份。

## 0.4.2 — 2026-11-05

**译文再长也各归其位**：默认检索范围的四个选项不再互相压字，窗口够宽就排成一行。**诊断先问 AI**：弹窗改成先复制给 AI 排查，解决不了再提 issue。

- `page`: 选项字段（默认检索范围、`es.exe` 编码）换成自绘的 `radiogroup`：每个选项按内容定宽，放不下时换行，不再借用 primitives 的 `SegmentedControl`——后者等宽分段加 `nowrap`，俄语的「Текущее рабочее пространство」（28 字符约 240px）在约 200px 的一段里会压到相邻选项与选中的高亮块上，控件本身还会撑出字段格子。
- `page`: 横跨整行的字段（默认检索范围）不再套 560px 上限，改用整行；四个选项在常见窗口下回到一行，不再是「一整块灰底、第二行只剩一个选项」。
- `page`: 选中态跟着各自选项的宽度走，不再用等分宽度的滑动指示牌，列宽不等时也不会对错格子；键盘 ←/→/↑/↓/Home/End 跳过禁用项。
- `page`: 诊断弹窗的提示改成「先复制给 AI 排查；确认解决不了，再提 issue。」，其中 `issue` 是指向仓库 issue 列表的链接；「家目录已换成 ~」从提示语里去掉（脱敏本身没变）。
- `i18n`: 六个语言包补上 `diagnose.issue`，`diagnose.hint` 按新口径重译；`{issue}` 占位符让每种语言自己决定链接摆在哪。
- `docs`: `docs/architecture.md` 记下这个控件为什么自绘；`docs/troubleshooting.md` 与两份 README 的「贴进 issue」改成「先给 AI，解决不了再开 issue」。
- `test`: 钉住整行字段不被 560px 卡住、单选组的换行与方向键、诊断提示里那个链接的落点。
- `package`: 版本号抬到 0.4.2（patch：只修用户可见的问题，没有新增能力）。

## 0.4.1 — 2026-11-04

**在市场里能被搜到了**：目录条目的中文一句话改成「本机文件搜索与文档全文检索」。插件市场的搜索是字面匹配，旧写法只有「检索」，搜「搜索」「文件搜索」「docx」都看不到这个插件。

- `docs`: 目录条目文案（`awesome-dsh-plugin` 的 YAML）补上「文件搜索 / 全文搜索 / 全文检索」与 PDF/DOCX/XLSX/PPTX/EPUB 这组扩展名——旧句里只有「检索」，于是 `搜索`/`文件搜索`/`本地搜索`/`全文检索`/`docx` 在插件市场里全是 0 命中。
- `package`: `description` 改成开门见山的中英双句，npm 页与第三方目录抓到的是同一句。
- `page`: 插件列表的标题一句话（`locale/zh.json` / `locale/en.json`）与配置卡片的描述同步同一口径；六种语言包的页面文案保持原译文。
- `docs`: `llms.txt` 的中文摘要改成「本机文件搜索与文档全文检索」，扩展名统一写 `PDF / DOCX / XLSX / PPTX / EPUB`。
- `docs`: README 的「Related plugins」收成「How this compares」三行对比表，链接指向各自的 GitHub 仓库，不再把读者送到竞品的目录安装页。
- `icon`: 图标重画成「纸 + 挖空放大镜」——文档是主体，放大镜从纸上挖出来，纸上三行内容；同时导出 `icon.png` 供目录站使用。
- `package`: 版本号抬到 0.4.1（patch：对外行为不变）。

## 0.4.0 — 2026-11-03

**认识环境**：平台识别、四态探测、路径语义。**能排查**：可复制诊断与错误码文档。**少打扰**：启动检查与右下角提示卡。**多语言**：按语言拆文件。

- `platform`: 新增 `lib/platform.js`——`detect()` 给出 `os` / `pathStyle` / `caseInsensitive` / `home` / 默认根（Windows 扫 A:–Z: 的现有盘根），三平台单测；平台默认值只从这一处出，别的模块不再读 `process.platform` 或 `process.env.SystemDrive`。
- `search`: `~/x` 在使用点展开成家目录（页面保存时写回解析后的绝对路径；手写 profile 里的 `~/x` 仍然有效）；绝对路径按目标平台的写法判，Windows 上也接受 `/Users/x`；`allRoots` 仍是分号分隔。
- `page`: 路径改写按 describe 给的 `platform` 走——Windows 上 `D:/alpha` 写成 `D:\alpha`，POSIX 写法原样保留；保存、失焦校验、测试连接共用同一套改写，并与 Host 的实现逐例比对。
- `engines`: 探测收进各后端（`probe()` → `ready` / `missing-tool` / `missing-index` / `down`）；`lib/probe.js` 只汇总归一，不再认识任何引擎；`sc.exe` 的安装判断留在 `everything.js`。
- `search`: 两条输出面各加一层过滤——`formatStatus` 只出 `ok` / `code` / `message`（加正在用的后端与几组根），模型拿不到四态、修法、插件版本；系统提示补一句「不要安装、启动或改配置这些引擎，说清哪个后端挂了、去插件卡里修」；`test/format.test.js` 钉住 `state` / `detail` / `hint` 不进输出。
- `config`: 新键 `checkEnginesOnStart`（默认开，配置页用开关渲染）；开着就每次启动探一次，结果只进 `describe.health`（`pending` / `failures` / `checkedAt` / `disabled`），不写配置；`autoconfig.failures` 删掉，首用那一次只负责写值，且不受开关影响。
- `page`: 右下角提示卡改为自绘（`shell.overlay`）：只在有失败时出现，颜色只走 `--dsw-*` token，一行一个后端挂自己的修法；卡不自动重探、也不自动消失，由用户关闭；关闭只记组件 state，不写 `sessionStorage`，跨会话的「别再提醒」由 `checkEnginesOnStart` 负责。缺 primitives 时关闭按钮退回原生 `button`。
- `route`: 新增只读 `GET /dsh-local-search/api/diagnose`，回 `{ text }`：插件与 DSH 版本、`profile` / `shell` / `remote`、平台与 node、每个后端的状态与 code、四个 scope、探测时刻；`os.homedir()` 与 `DSH_HOME` 在 Host 侧换成 `~`。每次现算，`no-store`，与其它路由共用同一道跨站门。
- `page`: 描述下面新增「复制诊断」——弹窗里是可全选的 `textarea` 加复制按钮；剪贴板被拒时退回手动全选，不只弹一句失败；没有 `Modal` 的部署不显示这个按钮。Host 在另一台机器上（页面不是 loopback）时，页面多一行说明「检索的是那台机器的盘」。
- `docs`: 新增 `docs/troubleshooting.md`（code → 谁产生 → 现象 → 修法，32 个 code）；README 里的错误码表删掉，只留一句回退建议与指向它的链接。
- `i18n`: 字典改成点号键名（`field.esPath.label`、`section.files`、`dialog.reset.title`），`FIELD_COPY` 并进基线同一棵树；新增 `GET /dsh-local-search/api/locales`（一次回全部语言包，按内容算 ETag / 304）与 `lib/locale-packs.js`；页面只给壳子 `getSnapshot().locales` 里已有的语言注册，不 `addLanguage`；zh / en 仍留在 bundle 里当同步基线。README 写清「加一种语言」两步。
- `i18n`: 附带 `de` / `es` / `fr` / `ja` / `pt`（巴西葡语）/ `ru` 六门初译，id 对齐 DSH 0.2.2 新增的语言；已按英文基线做过一轮审校，母语复核仍欢迎（整份替换）。没有对应包或 id 不匹配时回退英文，不影响页面。
- `test`: 新增 `test/platform.test.js`、`test/diagnose.test.js`、`test/locale-packs.test.js`；`test/everything.test.js` / `test/anytxt.test.js` / `test/probe.test.js` / `test/engines.test.js` 改到四态与 `probe`；`test/describe.test.js`、`test/route.test.js`、`test/bootstrap.test.js`、`test/format.test.js`、`test/client.test.js` 跟着新契约更新。
- `search`: `scope=all` 的根不再写死 `C:\` + `D:\`：Windows 上默认扫本机所有存在的盘符，插新盘下次调用就纳入；`scopes.allRoots` 有值时仍以配置为准。
- `search`: Anytxt 多根合并改成按各根名次轮转，`limit` 小时后面的根不再被第一个根挤掉；查询与文件名完全一致时置顶。
- `search`: 空结果不再把本次命中数写成「索引总数」；`query` 说明点明 `OR`/`AND` 是字面量，或、与要写成 `|`/`&`。
- `search`: 内容结果未到 100 条时只保留标题行的 `N of M`；到 100 条才补 `max 100`，不再在 5 条时就说上限。
- `search`: 默认检索范围改为 `all`（整台电脑）；新增 `scopes.defaultScope`（`all` / `workspace` / `work` / `personal`），`scope` 只用于收窄。
- `search`: 默认 `all` 的配置根全部不存在时退回 workspace，结果里带一行说明；配置为空仍按平台默认根。
- `probe`: 两个后端并行探测，最坏约 5 秒（原来串行、各吃一份 5 秒上限）；状态工具与复制诊断不再等两次超时。
- `status`: `local_search_status` 的 `all=` 按真实可用的根输出：回退 workspace 时带 `allFallback=workspace`，部分根缺失时带 `allMissing=…`；内容结果里同样写明。
- `status`: 「跳过/取消不算故障」的判据收进 `lib/status.js`，模型输出、诊断文本、启动提示卡三处共用。
- `diagnose`: 文本补上默认检索范围、`maxResults` / `readMaxChars`、配置的后端，以及首启的 `deferred` / 错误；`config:` 的键由 `lib/diagnose.js` 的 `CONFIG_FACTS` 单一导出，装配点照它组装。
- `config`: `limits.maxResults` 明确为「调用不传 `limit` 时的默认条数」，硬上限 100 不随配置变化。
- `page`: 中文/英文文案把“个人根/工作根/全局检索根”统一为“个人目录/工作目录/整台电脑的目录”，并新增“默认检索范围”选择。
- `page`: “默认检索范围”独占一行，四个目录字段按 2×2 排列；提示改成“不指定范围时用这个”，不再出现 `scope` 术语。
- `docs`: 范围示例改用 `~/Projects` / `~/Work`，不再默认 Windows 盘符；`es.exe` 与路径改写仍保留 Windows 示例。
- `docs`: 面向模型与页面的“盘符 / drive”改成“可检索的根 / root”；Windows 盘符、macOS 挂载卷、Linux `/home` 只出现在平台说明与 `status` 的实际根里。

## 0.3.1 — 2026-10-31

- `page`: 配置卡片不再因界面模块缺失而整块消失——`require('@deepseek-ai/dsh-client-ui-primitives')` 抛异常会连整个浏览器半边一起带走，现在包在 `try`/`catch` 里：缺模块时退成一行「本部署没有这个界面控件」，并在 console 留一条原因，工具与 profile 里的配置照旧可用。`dsh.client.inject` 也去掉了 primitives——它由宿主的模块表直接给，声明只排激活顺序（宿主没有对应的行就跳过），本来就不是硬依赖。
- `page`: 启动时的配置写回失败现在显示在页面描述下方，而不是只写一条用户不会去看的日志——`/api/describe` 的 `autoconfig.error` 之前一直被丢掉（迁移被拒也走这条）。
- `page`: 两个后端选择器补上各自的 `id`：原来 DOM 里是 `undefined-everything` / `undefined-anytxt`，同一个字段的 `label` 与 `aria-controls` 都指着它，再注册一个后端还会撞 id。新增一条测试钉住「每个控件都带浏览器要的可访问名（id + label）」。

## 0.3.0 — 2026-10-31

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

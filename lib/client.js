/**
 * dsh-local-search 的浏览器半边——插件的配置页。
 *
 * 它注册进 `plugins.item`，也就是 Plugins 页显示的 **Official plugins** 组，和 `dsh-github`
 * 贡献 GitHub 卡片的方式一样：一张卡，点开是本插件自己的页面。
 *
 * 卡片 id 必须等于设置命名空间（= 这个 bundle 的 patch 声明的行 id `fishdivinity-local-search`），
 * 页面才能用 `formFor(item.id)` 取到表单；写包名会查不到表单，页面就只剩「本部署没有提供设置
 * 命名空间」那一行。
 *
 * 页面不硬编码任何后端：能力节、每个后端有哪些字段、字段类型与上限，全部由 Host 的
 * `GET /dsh-local-search/api/describe` 给；这里只负责渲染，措辞留在本文件的字典里（zh/en 两列）。
 * 加一个后端时页面逻辑不用改，只补它两个语言的文案。
 *
 * 所有控件来自 `@deepseek-ai/dsh-client-ui-primitives`（读取当前主题的 `--dsw-*` token），
 * 本包不发布任何 CSS；版式照官方设置页：小节标题 + 响应式字段网格。
 *
 * 测试连接不能由页面直接 POST 本机 Anytxt JSON-RPC（跨源两边都拒），所以它问 Host 的只读
 * 探测路由（`lib/route.js`）。
 *
 * 确认与结果都在 primitives 的 `Modal` 里：它自己 portal 到 body，Esc 与焦点由壳子管；本包没有
 * 自绘浮层的样式，所以部署里缺 `Modal` 时退回页内提示（与 `Toast` 同一条规矩）。
 *
 * 分区（grep 这些词直接跳）：
 *   FIELD_COPY / dictionary —— 全部中英文案
 *   statusUrl / verifyQuery / draftPlan / applyCanonical / normalizeWinPath —— 校验与路径改写
 *   ConfigPage —— 页面（state → edit → checkField → verify/save/reset → dialogNode → children）
 *   EngineNotice / engineNotice / apply —— 首用提示与注册
 *
 * 本文件是发布出去的客户端 bundle，不是源码：客户端模块系统按 lazy-CJS 工厂格式把它当普通
 * 脚本执行，所以这里没有 ESM 的 import/export。
 */
window.__ModuleLoader__.load({
	id: '@fishdivinity/dsh-local-search',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const { createElement: h, useState, useEffect } = require('react');
		// 这个包由宿主的模块表作为静态种子给出：表里没有它时 `require` 抛异常，会让整张卡片连同
		// 这一个插件半边一起消失，而工具与 profile 里的配置本来都是好的。缺了就降级成一行
		// 「本部署没有这个界面控件」，用户仍可手写 profile。
		let primitives = {};
		try {
			primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {};
		} catch (error) {
			// 下面的就绪判断会接住空对象、页面走降级那条路；原因得留一条，否则「卡片为什么只剩一行」
			// 在 console 里查不到。
			console.warn('dsh-local-search: the client UI module is unavailable; the configuration card falls back to one line', error);
		}
		const {
			Button, Modal, SegmentedControl, SettingsForm, SettingsValueField, Toast,
		} = primitives;

		/** 本插件拥有的字典命名空间。 */
		const NS = 'localSearchConfig';
		/** 卡片 id，必须等于设置命名空间 = bundle patch 声明的行 id。 */
		const ITEM_ID = 'fishdivinity-local-search';
		/** Host 的后端描述路由，按本页自己的 base URI 解析。 */
		const DESCRIBE_ROUTE = '/dsh-local-search/api/describe';
		/** Host 的只读探测路由。 */
		const STATUS_ROUTE = '/dsh-local-search/api/status';
		/** 探测路由接受未保存地址的参数名。 */
		const DRAFT_PARAM = 'anytxtUrl';
		/** 探测路由校验未保存 `es.exe` 路径用的参数名。 */
		const DRAFT_PATH_PARAM = 'esPath';
		/** 探测路由校验未保存目录用的参数名（可重复）。 */
		const DRAFT_DIR_PARAM = 'dir';
		/** 只要校验草稿、不跑引擎探测的参数名：失焦校验用它。 */
		const CHECK_ONLY_PARAM = 'checkOnly';
		/** 本半边需要的客户端服务；两个都由 web shell 提供。 */
		const inject = ['slots', 'locale'];

		/** 每个引擎的下载页。本插件从不下载它们。 */
		const DOWNLOADS = {
			everything: 'https://www.voidtools.com/downloads/',
			anytxt: 'https://anytxt.net/download/',
		};

		/**
		 * 已保存地址允许指向的 host。这个 bundle 不能 import `lib/config.js`（普通脚本没有 ESM
		 * import），所以这份列表是 Host 那份的副本；有一条测试比对两者。
		 */
		const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

		/** 引擎不可用提示的「已提示过」标记，按浏览器会话记一次。 */
		const NOTICE_SEEN_KEY = 'dsh-local-search.engine-notice';
		/** 首用探测在后台跑，页面要等它结束才决定提不提示。 */
		const NOTICE_POLL_MS = 1500;
		/** 轮询上限：五次足够覆盖一次 es.exe + 一次 HTTP 的探测预算。 */
		const NOTICE_POLL_LIMIT = 5;

		/** 逐字段文案：[标签, 说明]。键名与 Host describe 的 labelKey / hintKey 一一对应。 */
		const FIELD_COPY = {
			esPath: {
				en: ['es.exe path', 'Full path, e.g. C:\\Tools\\es.exe; leave empty to detect it.'],
				zh: ['es.exe 路径', '完整路径，例如 C:\\Tools\\es.exe；留空自动查找。'],
			},
			esEncoding: {
				en: ['es.exe output encoding', 'GBK for a zh-CN console, UTF-8 otherwise.'],
				zh: ['es.exe 输出编码', '简中控制台选 GBK，其余选 UTF-8。'],
			},
			anytxtUrl: {
				en: ['Anytxt endpoint', 'A local address, e.g. http://127.0.0.1:9920.'],
				zh: ['Anytxt 地址', '本机地址，例如 http://127.0.0.1:9920。'],
			},
			workspaceRoot: {
				en: ['Workspace root', 'A full directory, e.g. D:\\Alpha; empty follows the working directory.'],
				zh: ['工作区根', '完整目录，例如 D:\\Alpha；留空跟随当前工作目录。'],
			},
			workRoot: {
				en: ['Work root', 'A full directory, e.g. E:\\Beta; the scope is unavailable while empty.'],
				zh: ['工作根', '完整目录，例如 E:\\Beta；留空则这个范围不可用。'],
			},
			personalRoot: {
				en: ['Personal root', 'A full directory; the scope is unavailable while empty.'],
				zh: ['个人根', '完整目录；留空则这个范围不可用。'],
			},
			allRoots: {
				en: ['All-scope roots', 'Full directories separated by semicolons, e.g. D:\\Alpha;E:\\Beta; empty uses C: and D:.'],
				zh: ['全局检索根', '多个完整目录，分号隔开，例如 D:\\Alpha;E:\\Beta；留空用 C: 与 D:。'],
			},
			maxResults: {
				en: ['Results per call', 'Results per call, 1–100.'],
				zh: ['每次结果数', '每次返回多少条，1–100。'],
			},
			readMaxChars: {
				en: ['Read window (characters)', 'Characters per read, 1–20,000.'],
				zh: ['读取窗口（字符）', '每次读取多少字符，1–20,000。'],
			},
		};

		/** 版式样式，全部取自主题 token；皮肤要改就覆盖 token。 */
		const H3_STYLE = { margin: 0, fontSize: '13px', fontWeight: '600', lineHeight: '1.5', color: 'var(--dsw-alias-label-primary)' };
		const LABEL_STYLE = { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' };
		const HINT_STYLE = { margin: '4px 0 0', fontSize: '12px', lineHeight: '1.6', color: 'var(--dsw-alias-label-secondary)' };
		/**
		 * 被拦下的保存、以及重置的提示共用这一行样式：红色、正常字重。
		 *
		 * token 名必须是主题真有的：`--dsw-alias-state-warning-primary` 不存在，写错只会静默
		 * 回落到普通文字色（看起来像没上色）。状态的专用 token 是
		 * `--dsw-alias-state-{error,warn,success}-primary`。
		 */
		const NOTICE_STYLE = {
			margin: '8px 0 0',
			fontSize: '13px',
			lineHeight: '1.6',
			color: 'var(--dsw-alias-state-error-primary)',
		};
		/**
		 * 探测结果的无序列表：一行一个引擎，失败的那行下面跟一句修法。
		 *
		 * 字号/行高/颜色照壳子弹窗正文那句 `_description`（14px / 22px / label-primary）写：
		 * 不写就会继承到别处的基准字号（16px），跟「重置」「仍要保存？」那些弹窗的正文差一档。
		 */
		const PROBE_LIST_STYLE = {
			margin: 0,
			paddingLeft: '18px',
			fontSize: '14px',
			lineHeight: '22px',
			color: 'var(--dsw-alias-label-primary)',
		};
		const PROBE_ITEM_STYLE = { marginTop: '2px' };
		/** 修法那行：比结论浅一档，是补充说明，不跟结论抢同一行。 */
		const PROBE_FIX_STYLE = {
			display: 'block',
			fontSize: '12px',
			lineHeight: '1.6',
			color: 'var(--dsw-alias-label-secondary)',
		};
		/**
		 * 探测结果那块的外壳。
		 *
		 * 弹窗没有 `description` 时，壳子给 `.body` 固定加 20px 上边距，于是列表比「重置」那种
		 * 弹窗的正文低一截，标题下面空一块。把这个负边距还回去，列表就从和 description 一样的
		 * 位置开始；`body` 是 flex 列、不与子元素折叠外边距，所以这 20px 会被真的抵消。
		 */
		const PROBE_BODY_STYLE = { marginTop: '-20px' };
		/** 链接用主题的链接色：品牌色在亮色主题下是近黑，看起来像没上色。 */
		const LINK_STYLE = { color: 'var(--dsw-alias-link)', textDecoration: 'none' };
		const ROW_STYLE = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' };
		/**
		 * 字段网格：两列，整块限宽 1100px，容器窄于 {@link WIDE_QUERY} 时回落一列。
		 *
		 * 为什么不是 `auto-fit` + 最小列宽：一条最小列宽没法同时满足「700px 的容器也排两列」和
		 * 「全屏不要第三列」——前者要求 ≤342px，后者要求 >366px（1100/3）。所以列数直接由宽度
		 * 判断（`matchMedia`），两列时每列 `1fr`，全屏就是原来的 2×542。
		 */
		const WIDE_QUERY = '(min-width: 656px)';
		const GRID_MAX_WIDTH = '1100px';

		function gridStyle(wide) {
			return {
				display: 'grid',
				gridTemplateColumns: wide ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
				gap: '16px',
				marginTop: '8px',
				maxWidth: GRID_MAX_WIDTH,
			};
		}

		const SECTION_STYLE = { minWidth: 0, padding: '16px 0' };
		/** 一个字段占的格子；上限让单列布局不至于横贯整屏。 */
		const CELL_STYLE = { minWidth: 0, maxWidth: '560px' };
		/** 后端选择器只占一小条，别拉满整行。 */
		const SELECTOR_STYLE = { marginTop: '8px', maxWidth: '320px' };
		/** 重置那行：描述正下方，靠下留白与第一个小节分开。 */
		const RESET_TOP_STYLE = { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' };

		function dictionary(copy) {
			const words = {
				description: copy('只读的 Everything 文件名检索与 Anytxt 文档内容检索。', 'Read-only Everything filename search and Anytxt document-content search.'),
				itemLabel: copy('本地搜索', 'Local Search'),
				sectionFiles: copy('文件名检索', 'File names'),
				sectionContent: copy('文件内容检索', 'File contents'),
				sectionScopes: copy('检索范围', 'Search scopes'),
				sectionLimits: copy('上限', 'Limits'),
				engineEverything: 'Everything',
				engineAnytxt: 'Anytxt',
				note: copy(
					'单次调用的超时只能改 profile 的 YAML，改完要重载插件。',
					'The per-call timeout lives in the profile YAML only; change it there and reload the plugin.',
				),
				invalidValue: copy('这个值不合法。', 'Not a valid value.'),
				invalidNumber: copy('请填范围内的整数。', 'Enter a whole number in range.'),
				invalidFile: copy('这个文件不存在。', 'No such file.'),
				invalidDir: copy('这个目录不存在。', 'No such directory.'),
				invalidNotFile: copy('这里要填文件，不是目录。', 'A file goes here, not a directory.'),
				invalidNotDir: copy('这里要填目录，不是文件。', 'A directory goes here, not a file.'),
				invalidLocal: copy('只支持本机地址。', 'A local address only.'),
				unavailable: copy(
					'当前部署没有提供本插件的设置命名空间，请改在 profile 的 cordis.patch.yml 里配置。',
					"This deployment does not serve this plugin's settings; set the values in the profile's cordis.patch.yml instead.",
				),
				primitivesMissing: copy(
					'这个部署没有本配置页要的界面控件（插件的界面模块缺失或太旧），请改在 profile 的 cordis.patch.yml 里配置；检索工具不受影响。',
					"This deployment lacks the UI controls this page needs (the plugin's UI module is missing or too old); set the values in the profile's cordis.patch.yml instead. The search tools keep working.",
				),
				readOnly: copy('本部署的设置为只读。', 'This deployment stores settings read-only.'),
				saveFailed: copy('宿主没有接受这些值。', 'The Host did not accept these values.'),
				save: copy('保存', 'Save'),
				saving: copy('保存中…', 'Saving…'),
				// 拼接用的标点：中文全角、英文半角加空格。写死在模板里，英文界面就会冒出「。」。
				listSeparator: copy('、', ', '),
				colon: copy('：', ': '),
				fullStop: copy('。', '.'),
				saveAnyway: copy('仍然保存', 'Save anyway'),
				saveEngineDown: copy('引擎现在不可用：', 'The engine is unavailable now: '),
				saveNoWrite: copy('，没有写入。', ', nothing was written.'),
				savePathMissing: copy('es.exe 路径上找不到文件', 'No file at that es.exe path'),
				savePathNotFile: copy('es.exe 路径是个目录，不是文件', 'The es.exe path is a directory, not a file'),
				saveDirMissing: copy('这个目录不存在', 'No such directory'),
				saveDirNotDir: copy('这个路径是个文件，不是目录', 'That path is a file, not a directory'),
				saveEndpointInvalid: copy('这个地址不被接受', 'That address was rejected'),
				saveBlockedTitle: copy('无法保存', 'Could not save'),
				saveAnywayTitle: copy('仍要保存？', 'Save anyway?'),
				close: copy('关闭', 'Close'),
				cancel: copy('取消', 'Cancel'),
				reset: copy('重置', 'Reset'),
				resetTitle: copy('重置', 'Reset'),
				resetConfirm: copy('确认重置', 'Confirm reset'),
				resetHint: copy(
					'按探测结果重新填入；检索范围保留，其余恢复默认。',
					'Refills from a fresh probe; search scopes stay and everything else returns to its default.',
				),
				resetting: copy('重置中…', 'Resetting…'),
				resetDone: copy('已重置。', 'Reset done.'),
				resetFailed: copy('重置没有写进去。', 'The reset was not written.'),
				describeLoading: copy('正在读取后端列表…', 'Loading the backend list…'),
				describeFailed: copy('读不到后端列表：', 'Could not read the backend list:'),
				autoconfigFailed: copy('启动时的配置写回没有成功：', 'The startup config write did not land: '),
				retry: copy('重试', 'Retry'),
				encodingGbk: copy('GBK（简中）', 'GBK (zh-CN)'),
				encodingUtf8: 'UTF-8',
				test: copy('测试连接', 'Test connection'),
				testing: copy('测试中…', 'Testing…'),
				testAgain: copy('再测一次', 'Test again'),
				testHint: copy(
					'用上面输入框里的地址试一次，不用先保存；只探测，不改配置。',
					'Probes the address above without saving it first; changes nothing.',
				),
				testLocalOnly: copy(
					'地址必须是本机 http(s)：127.0.0.1、localhost 或 [::1]。',
					'The address must be a local http(s) url: 127.0.0.1, localhost or [::1].',
				),
				testFailed: copy('测试请求失败', 'The test request failed'),
				everythingOk: copy('Everything 正常', 'Everything: OK'),
				everythingDown: copy('Everything 不可用', 'Everything: DOWN'),
				anytxtOk: copy('Anytxt 正常', 'Anytxt: OK'),
				anytxtDown: copy('Anytxt 不可达', 'Anytxt: DOWN'),
				downloadEverything: copy('下载 Everything', 'Download Everything'),
				downloadAnytxt: copy('下载 Anytxt', 'Download Anytxt'),
				fixEverythingNotRunning: copy(
					'已安装但没在运行：启动它',
					'Installed but not running: start it',
				),
				fixEverythingNotInstalled: copy(
					'没装：先安装 Everything',
					'Not installed: install Everything first',
				),
				fixEverythingEsMissing: copy(
					'缺 es.exe：装上后填到上面的路径',
					'es.exe is missing: install it and set the path',
				),
				noticeEnginesDown: copy('这些检索后端现在不可用：', 'These search backends are unavailable: '),
			};
			for (const [key, entry] of Object.entries(FIELD_COPY)) {
				words[`${key}Label`] = copy(entry.zh[0], entry.en[0]);
				words[`${key}Hint`] = copy(entry.zh[1], entry.en[1]);
			}
			return words;
		}

		const en = dictionary((zhText, enText) => enText);
		const zh = dictionary((zhText) => zhText);

		/**
		 * 本页 base URI 下的一条路由，因此挂载在 origin 子路径上的部署也能到达 Host。
		 * @param path - Host 上的绝对路径
		 * @returns 请求路径
		 */
		function api(path) {
			const relative = String(path).replace(/^\/+/, '');
			if (typeof document === 'undefined') return `/${relative}`;
			return new URL(relative, document.baseURI).pathname;
		}

		/** 取后端描述。 */
		function describeUrl() {
			return api(DESCRIBE_ROUTE);
		}

		/**
		 * 探测请求的地址。草稿走查询串，所以测试永远不需要先保存；Host 只接受本机 `http(s)`
		 * 的地址、只查存在性的 `es.exe` 路径。
		 * @param draft - 输入框里的地址，空串表示探测已保存的值
		 * @param esPath - 输入框里的 `es.exe` 路径，空串表示用已保存的（或自动查找）
		 * @returns 请求路径，含查询串
		 */
		function statusUrl(draft, esPath) {
			const path = api(STATUS_ROUTE);
			const params = new URLSearchParams();
			const address = String(draft ?? '').trim();
			if (address !== '') params.set(DRAFT_PARAM, address);
			const binary = String(esPath ?? '').trim();
			if (binary !== '') params.set(DRAFT_PATH_PARAM, binary);
			const query = params.toString();
			return query === '' ? path : `${path}?${query}`;
		}

		/** 路径的字符串键；staged 用它当 Map 键。 */
		function pathKey(path) {
			return path.join('.');
		}

		/** 沿路径取值。 */
		function pathValue(object, path) {
			let node = object;
			for (const key of path) {
				if (node === null || typeof node !== 'object') return undefined;
				node = node[key];
			}
			return node;
		}

		/** 盘符路径 / UNC 路径。只重写这两种写法，POSIX 与相对路径原样留着。 */
		const WINDOWS_PATH = /^[a-z]:[\\/]/i;
		const UNC_PATH = /^[\\/]{2}/;

		/**
		 * 把一个路径草稿改写成标准写法：盘符大写、只用 `\`、去掉多余与末尾的分隔符。
		 *
		 * 只认 `D:\` / `D:/` 与 `\\server\share` 两种开头——别的部署写 `/home/me` 时，把分隔符
		 * 换成 `\` 只会造出一个不存在的路径。名字里的空格、中文、`drawio a` 那种带空格的目录名
		 * 都不动：Windows 允许，宿主也是按值传给 `es.exe` 与 `fs`，不经过 shell。
		 * @param text - 输入框里的路径
		 * @returns 标准写法；空串仍是空串
		 */
		function normalizeWinPath(text) {
			const trimmed = String(text ?? '').trim();
			if (trimmed === '') return '';
			if (!WINDOWS_PATH.test(trimmed) && !UNC_PATH.test(trimmed)) return trimmed;
			const unc = UNC_PATH.test(trimmed);
			let value = trimmed.replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
			// 折叠分隔符会把 UNC 开头的两个也压成一个，这里补回来。
			if (unc) value = `\\${value}`;
			if (/^[a-z]:/.test(value)) value = `${value[0].toUpperCase()}${value.slice(1)}`;
			// 目录末尾的分隔符没有信息量；盘符根 `D:\` 只有三个字符，留着。
			if (value.length > 3 && value.endsWith('\\')) value = value.replace(/\\+$/, '');
			return value;
		}

		/**
		 * 分号列表的同一个改写；空项丢掉（它们本来就会被 verifyQuery 跳过）。
		 * @param text - 分号分隔的目录列表
		 * @returns 标准写法，分号分隔
		 */
		function normalizeWinPaths(text) {
			return String(text ?? '')
				.split(';')
				.map((value) => normalizeWinPath(value))
				.filter((value) => value !== '')
				.join(';');
		}

		/**
		 * 保存前把带路径语义的草稿改写成标准写法。
		 * @param staged - 路径键到草稿
		 * @param fields - 路径键到 describe 字段
		 * @returns 改写后的草稿，以及是否真的改动了
		 */
		function normalizeStaged(staged, fields) {
			let changed = false;
			const next = {};
			for (const [key, entry] of Object.entries(staged)) {
				const field = fields.get(key);
				if (entry.op !== 'set' || field === undefined) {
					next[key] = entry;
					continue;
				}
				const text = String(entry.text);
				const normalized = field.verifyPath === true
					? normalizeWinPath(text)
					: field.verifyDir === true ? normalizeWinPaths(text) : text;
				if (normalized === text) {
					next[key] = entry;
					continue;
				}
				changed = true;
				next[key] = { ...entry, text: normalized };
			}
			return { next, changed };
		}

		/**
		 * 一个字段的草稿要翻成哪些查询参数。
		 *
		 * 保存前的整表校验、失焦时的单字段校验、测试连接都走这里：参数名与拆分规则只写一遍
		 * ——以前三处各写一份，加字段时总会漏掉一处。
		 * @param field - describe 给的字段
		 * @param text - 输入框里的值
		 * @returns 参数名到值的列表；不可校验或空值时为空
		 */
		function draftEntries(field, text) {
			const value = String(text ?? '').trim();
			if (value === '') return [];
			if (field.probeEndpoint === true) return [[DRAFT_PARAM, value]];
			if (field.verifyPath === true) return [[DRAFT_PATH_PARAM, normalizeWinPath(value)]];
			if (field.verifyDir === true) {
				// `allRoots` 是分号列表：每个目录单独校验，空项跳过。
				return normalizeWinPaths(value).split(';').filter(Boolean).map((dir) => [DRAFT_DIR_PARAM, dir]);
			}
			return [];
		}

		/**
		 * 一次保存要交给 Host 校验的草稿，按发送顺序列出。
		 *
		 * 顺序是回填的依据：Host 按同样的顺序回答每个目录的规范写法（磁盘上的真实大小写），所以
		 * 查询串与回填都从这份清单来，不能各算一遍。
		 * @param staged - 路径键到草稿
		 * @param fields - 路径键到 describe 字段
		 * @returns 每一项的路径键、种类（endpoint/path/dir）、规范后的值
		 */
		function draftPlan(staged, fields) {
			const plan = [];
			for (const [key, entry] of Object.entries(staged)) {
				if (entry.op !== 'set') continue;
				const field = fields.get(key);
				if (field === undefined) continue;
				const entries = draftEntries(field, entry.text);
				if (entries.length === 0) continue;
				const kind = field.probeEndpoint === true ? 'endpoint' : field.verifyPath === true ? 'path' : 'dir';
				const values = entries.map(([, value]) => value);
				plan.push({
					key,
					kind,
					text: kind === 'dir' ? values.join(';') : values[0],
					dirs: kind === 'dir' ? values : [],
					entries,
				});
			}
			return plan;
		}

		/**
		 * 保存前要交给 Host 校验的草稿查询串。
		 *
		 * 只有「能安全校验」的字段进得来：地址（Host 用草稿探测）、`es.exe` 路径（Host 只查
		 * 文件存在，绝不启动它）、以及目录类字段（只查是不是一个已存在的目录）。没有可校验字段
		 * 时返回空串，保存就不必先多发一次请求。
		 * @param staged - 路径键到草稿
		 * @param fields - 路径键到 describe 字段
		 * @returns 查询串（不含 `?`），或空串
		 */
		function verifyQuery(staged, fields) {
			const params = new URLSearchParams();
			for (const item of draftPlan(staged, fields)) {
				for (const [name, value] of item.entries) params.append(name, value);
			}
			return params.toString();
		}

		/**
		 * 把 Host 回来的规范写法（磁盘上的真实大小写、真实分隔符）写回草稿。
		 *
		 * 只改写法，不改语义：`value` 已经校验过存在，`resolved` 指向同一个文件/目录。
		 * @param draft - 规范化之后的草稿
		 * @param fields - 路径键到 describe 字段
		 * @param drafts - status 路由回答里的 `drafts`
		 * @returns 改写后的草稿；没有可回填的值时原样返回
		 */
		function applyCanonical(draft, fields, drafts) {
			if (drafts === undefined || drafts === null) return draft;
			const plan = draftPlan(draft, fields);
			let cursor = 0;
			let changed = false;
			const next = { ...draft };
			for (const item of plan) {
				if (item.kind === 'path') {
					const value = drafts.esPath;
					if (typeof value !== 'string' || value === '' || value === item.text) continue;
					next[item.key] = { ...next[item.key], text: value };
					changed = true;
					continue;
				}
				if (item.kind !== 'dir') continue;
				const slice = (drafts.dirs ?? []).slice(cursor, cursor + item.dirs.length);
				cursor += item.dirs.length;
				if (slice.length !== item.dirs.length) continue;
				const joined = slice.join(';');
				if (joined === item.text) continue;
				next[item.key] = { ...next[item.key], text: joined };
				changed = true;
			}
			return changed ? next : draft;
		}

		/**
		 * 从探测结果里取「要写回某个字段的值」。
		 * @param probed - status 路由的回答
		 * @param from - 点分路径，如 `everything.path`
		 * @returns 非空字符串，或 undefined
		 */
		function fillValue(probed, from) {
			let node = probed;
			for (const key of String(from ?? '').split('.')) {
				if (node === null || typeof node !== 'object') return undefined;
				node = node[key];
			}
			return typeof node === 'string' && node !== '' ? node : undefined;
		}

		/**
		 * 一次保存提交的原子操作列表。清空的字段是 `unset`，回落到 profile 层，而不是钉一个
		 * 空覆盖值。
		 * @param staged - 路径键到 `{ op: 'set', text }` 或 `{ op: 'unset' }`
		 * @returns 保存提交的操作
		 */
		function operations(staged) {
			return Object.entries(staged).map(([key, entry]) => {
				if (entry.op === 'unset') return { op: 'unset', path: key.split('.') };
				return { op: 'set', path: key.split('.'), value: entry.numeric === true ? Number(entry.text) : entry.text };
			});
		}

		/**
		 * 值是否是本机 `http(s)` 地址——Host 只接受这种形状，所以字段先拒绝同一批值。
		 * @param value - 候选地址
		 * @returns 本机 `http(s)` 地址时为 true
		 */
		function isLoopbackUrl(value) {
			let parsed;
			try {
				parsed = new URL(String(value));
			} catch {
				return false;
			}
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
			const host = parsed.hostname.replace(/^\[|\]$/g, '');
			return LOOPBACK_HOSTS.includes(host);
		}

		/**
		 * 已保存的值该落在那一段上。
		 *
		 * 0.1 接受任意 `TextDecoder` 标签，所以旧的 `utf8`（或 `gb18030`）要落到正确的段，
		 * 而不是显示成 GBK 再在保存时把值改写。别名表由 Host 的 describe 给。
		 * @param field - describe 给的字段描述
		 * @param value - 已保存的值
		 * @returns 选中的 choice 值
		 */
		function choiceValue(field, value) {
			const normalize = (raw) => String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
			const key = normalize(value);
			const exact = field.choices.find((choice) => normalize(choice.value) === key);
			if (exact !== undefined) return exact.value;
			const alias = field.aliases === undefined ? undefined : field.aliases[key];
			return alias === undefined ? field.choices[0].value : alias;
		}

		/**
		 * 保存会被拒绝的第一个草稿字段。
		 *
		 * 只管「不借助文件系统就能判」的那些：整数范围在这里挡，地址留到失焦或保存前的 Host
		 * 校验（`isLoopbackUrl` 判得了形状，但把红字提前到每敲一个字符就跳出来只会烦人）。
		 * @param staged - 路径键到草稿
		 * @param fields - 路径键到 describe 字段
		 * @returns 路径键；全部可接受时 undefined
		 */
		function invalidField(staged, fields) {
			for (const [key, entry] of Object.entries(staged)) {
				if (entry.op === 'unset') continue;
				const field = fields.get(key);
				if (field === undefined) continue;
				if (field.type === 'count') {
					const value = Number(entry.text);
					if (!Number.isInteger(value) || value < 1 || value > field.max) return key;
				}
			}
			return undefined;
		}

		/**
		 * 探测结果：一行一个引擎，通过的带版本，失败的不带错误码——修法比错误码有用。
		 *
		 * 修法挂在失败的那一行下面，所以两处都不再重复引擎名（原来两行结论下面拼一行
		 * 「Everything 已安装但没在运行：启动它。 · 下载 Anytxt」，既重复又对不上是哪个引擎）。
		 * @param t - 字典查找
		 * @param body - 路由的 JSON 回答
		 * @returns 每个引擎的状态行与（可选的）修法
		 */
		function probeResult(t, body) {
			const everything = body.everything ?? {};
			const anytxt = body.anytxt ?? {};
			return [
				{
					key: 'everything',
					text: everything.ok
						? `${t('everythingOk')}${everything.version ? ` · ${everything.version}` : ''}`
						: t('everythingDown'),
					fix: everything.ok ? undefined : everythingGuidance(t, everything),
				},
				{
					key: 'anytxt',
					text: anytxt.ok ? t('anytxtOk') : t('anytxtDown'),
					fix: anytxt.ok ? undefined : { key: 'anytxt', text: t('downloadAnytxt'), href: DOWNLOADS.anytxt },
				},
			];
		}

		/**
		 * 修好一次失败探测所需的唯一动作。
		 * @param t - 页面的翻译函数
		 * @param everything - 路由的 Everything 回答，含 `detail`
		 * @returns 一行指引，只有下载才是解法时才带链接
		 */
		function everythingGuidance(t, everything) {
			if (everything.detail === 'not-running') return { key: 'everything', text: t('fixEverythingNotRunning') };
			if (everything.detail === 'not-installed') {
				return { key: 'everything', text: t('fixEverythingNotInstalled'), href: DOWNLOADS.everything };
			}
			if (everything.detail === 'es-missing') {
				return { key: 'everything', text: t('fixEverythingEsMissing'), href: DOWNLOADS.everything };
			}
			return { key: 'everything', text: t('downloadEverything'), href: DOWNLOADS.everything };
		}

		/**
		 * 一个小节：小标题、可选的后端选择器、官方网格上的字段，以及网格下的附加块。
		 * @param props - 标题、标题 id、选择器、网格样式、字段与页脚
		 * @returns 小节元素
		 */
		function Section(props) {
			return h('section', { style: SECTION_STYLE, 'aria-labelledby': props.id },
				h('h3', { id: props.id, style: H3_STYLE }, props.title),
				props.header === undefined ? null : props.header,
				h('div', { style: props.grid }, props.children),
				props.footer === undefined ? null : props.footer,
			);
		}

		/**
		 * 二选一字段。取值集合是封闭的，所以用控件而不是文本框——文本框会让用户敲出一个
		 * 静默回退到 UTF-8 的错值。
		 */
		function ChoiceField(props) {
			const { t, field, id, value, invalid, disabled, onEdit } = props;
			const label = t(field.labelKey);
			const options = field.choices.map((choice) => ({
				value: choice.value,
				label: choice.labelKey === undefined ? String(choice.value) : t(choice.labelKey),
			}));
			return h('div', { style: { minWidth: 0 } },
				h('div', { style: ROW_STYLE },
					h('span', { style: LABEL_STYLE }, label),
				),
				h('div', { style: { marginTop: '6px' } },
					h(SegmentedControl, {
						id,
						value: choiceValue(field, value),
						options,
						onChange: onEdit,
						label,
						disabled,
					}),
				),
				h('p', { style: HINT_STYLE }, t(field.hintKey)),
				invalid ? h('p', { role: 'alert', style: HINT_STYLE }, t('invalidValue')) : null,
			);
		}

		/**
		 * 两种表面共用的配置表单。
		 * @param props - 语言、视图与配置表单
		 * @returns 页面的 React 节点
		 */
		function ConfigPage(props) {
			const { t, form, view } = props;
			const [staged, setStaged] = useState({});
			const [saving, setSaving] = useState(false);
			const [failed, setFailed] = useState(false);
			// 探测：idle → running → done / rejected（地址被拒）/ path-missing（es.exe 不在）/
			// path-not-file（es.exe 位置上是个目录）/ failed。
			const [probe, setProbe] = useState({ status: 'idle' });
			const [described, setDescribed] = useState({ status: 'idle' });
			const [reload, setReload] = useState(0);
			// 保存前校验：idle → running → idle / failed。失败时由弹窗问一次「仍然保存」。
			const [check, setCheck] = useState({ status: 'idle' });
			// 只在没有 Modal 的部署里用：按过一次「仍然保存」后，下一次保存跳过校验。
			const [override, setOverride] = useState(false);
			// 统一重置：idle → running → done / failed。没有 Modal 的部署才多一个 confirm（点两下）。
			const [resetState, setResetState] = useState({ status: 'idle' });
			// 开着的弹窗：{ kind: 'reset' }、{ kind: 'save-anyway', message }、
			// { kind: 'blocked', message } 或 { kind: 'probe', field }。
			const [dialog, setDialog] = useState(null);
			// 失焦校验的结论：路径键 → 'missing' | 'not-file' | 'not-dir' | 'bad-url'。值一改就清掉。
			const [pathChecks, setPathChecks] = useState({});
			// 列数由宽度决定：656px 以下一列，以上两列，两列时每列 1fr（全屏就是 2×542）。
			const [wide, setWide] = useState(true);

			useEffect(() => {
				if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
				const query = window.matchMedia(WIDE_QUERY);
				setWide(query.matches);
				const onChange = (event) => setWide(event.matches);
				query.addEventListener('change', onChange);
				return () => query.removeEventListener('change', onChange);
			}, []);

			// 后端描述只在页面视图里取；拿不到就显示一行可重试的提示，而不是空白表单。
			//
			// 依赖数组里只能放「什么时候该重取」的因素（视图、重试次数），绝不能放结果状态：
			// 一旦 status 进了依赖，effect 里那句「标记为读取中」会立刻触发一次 cleanup，把本次
			// 请求的 live 置 false，于是请求回来时被丢掉，页面就永远停在「正在读取后端列表…」。
			useEffect(() => {
				if (view !== 'page') return undefined;
				let live = true;
				fetch(describeUrl(), { cache: 'no-store' })
					.then((response) => {
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						return response.json();
					})
					.then((body) => {
						if (live) setDescribed({ status: 'done', body });
					})
					.catch((error) => {
						if (!live) return;
						setDescribed({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
					});
				return () => {
					live = false;
				};
			}, [view, reload]);

			// 摘要渲染拿不到 form，所以它不能假装持有值状态。
			if (view === 'summary') return h('span', null, t('description'));

			// 部署里的 primitives 可能整个缺失、也可能比这些控件旧：两种都显示这一行，而不是让宿主
			// 页面的树里抛异常。每一项都必须在，但不能按「是不是函数」判断——`Button` 是
			// `forwardRef` 的返回值（对象）。
			const primitivesReady = [SettingsForm, SettingsValueField, Button, SegmentedControl]
				.every((primitive) => primitive !== undefined && primitive !== null);
			if (!primitivesReady) {
				return h('p', { role: 'status' }, t('primitivesMissing'));
			}

			const values = form?.state.value ?? {};
			const writable = form?.state.writable ?? false;
			// 弹窗与 `Toast` 一样不是每个部署都有：没有就退回页内提示，而不是让这棵 React 树抛异常。
			const dialogReady = Modal !== undefined && Modal !== null;
			const sections = described.status === 'done' ? described.body.sections ?? [] : [];
			const resetInfo = described.status === 'done' ? described.body.reset : undefined;
			// 所有后端的所有字段，按路径键索引：校验和取值都要用它，不能只看当前选中后端的。
			const fields = new Map();
			for (const section of sections) {
				for (const field of section.fields ?? []) fields.set(pathKey(field.path), field);
			}
			const invalid = invalidField(staged, fields);
			const dirty = Object.keys(staged).length > 0;
			const busy = saving || probe.status === 'running' || check.status === 'running' || resetState.status === 'running';
			const disabled = !writable || busy;

			const edit = (path, text, numeric) => {
				const key = pathKey(path);
				// 清空 = unset（回落到 profile 层或默认值），不是写一个空覆盖值把 profile 挡住。
				const cleared = String(text ?? '').trim() === '';
				setStaged((previous) => ({
					...previous,
					[key]: cleared ? { op: 'unset' } : { op: 'set', text, numeric: numeric === true },
				}));
				// 草稿一变，上一次的「仍然保存」、校验结论、失焦结论与开着的弹窗就都过期了。
				setCheck({ status: 'idle' });
				setOverride(false);
				setResetState({ status: 'idle' });
				setDialog(null);
				clearPathCheck(key);
			};
			const valueOf = (path) => {
				const entry = staged[pathKey(path)];
				if (entry === undefined) return pathValue(values, path);
				// 清空的字段显示成空串——别把已保存的值弹回输入框，那会让「清空」看起来没生效。
				return entry.op === 'unset' ? '' : entry.text;
			};
			// 选中的后端：草稿优先，空值回落到 describe 的第一个后端。
			const backendOf = (section) => {
				if (section.backendPath === undefined) return undefined;
				const value = String(valueOf(section.backendPath) ?? '');
				if (value !== '') return value;
				return section.backends?.[0]?.name;
			};
			const visibleFields = (section) => (section.fields ?? [])
				.filter((field) => field.backend === undefined || field.backend === backendOf(section));

			const clearPathCheck = (key) => {
				setPathChecks((previous) => {
					if (previous[key] === undefined) return previous;
					const next = { ...previous };
					delete next[key];
					return next;
				});
			};

			/**
			 * 失焦时判一次这个字段：路径问 Host 还在不在，地址在本地判形状。
			 *
			 * 边打字边校验会在半截值上一直报错，所以只在这里做；路径那条请求带 `checkOnly`，
			 * 不花一次 es.exe 启动。取不到答案（网络失败）时不标红——那是 Host 的问题，不是值的问题。
			 * @param field - describe 给的字段
			 */
			const checkField = async (field) => {
				const key = pathKey(field.path);
				const text = String(valueOf(field.path) ?? '').trim();
				if (field.localUrl === true) {
					if (text === '' || isLoopbackUrl(text)) clearPathCheck(key);
					else setPathChecks((previous) => ({ ...previous, [key]: 'bad-url' }));
					return;
				}
				const entries = draftEntries(field, text);
				if (entries.length === 0) {
					clearPathCheck(key);
					return;
				}
				const params = new URLSearchParams();
				for (const [name, value] of entries) params.append(name, value);
				params.set(CHECK_ONLY_PARAM, '1');
				let reason;
				try {
					const response = await fetch(`${api(STATUS_ROUTE)}?${params}`, { cache: 'no-store' });
					if (response.ok) {
						clearPathCheck(key);
						return;
					}
					const body = await response.json().catch(() => undefined);
					reason = body?.code === 'ES_PATH_NOT_FILE' ? 'not-file'
						: body?.code === 'DIR_NOT_DIRECTORY' ? 'not-dir' : 'missing';
				} catch {
					return;
				}
				setPathChecks((previous) => ({ ...previous, [key]: reason }));
			};

			// 字段原件用 `.field + .field` 画分隔线，直接进网格会在格子里画一条半宽横线。
			// 所以每个字段都包一层普通 div，官方 subagent 页也是这么做的。失焦挂在这一层上：
			// 原件没有 onBlur 入参，而 focusout 会从输入框冒到这里。
			const cell = (field) => h('div', {
				key: pathKey(field.path),
				style: CELL_STYLE,
				onBlur: () => { void checkField(field); },
			}, fieldNode(field));

			/** 失焦结论 → 红字文案。 */
			const invalidCopy = (field, reason) => {
				if (reason === 'not-file') return t('invalidNotFile');
				if (reason === 'not-dir') return t('invalidNotDir');
				if (reason === 'bad-url') return t('invalidLocal');
				if (field.verifyPath === true) return t('invalidFile');
				if (field.verifyDir === true) return t('invalidDir');
				return t('invalidValue');
			};

			// 字段上不挂徽标与重置：这个插件只有一个写入面，逐行标「本页设置」没有信息量；
			// 回默认值交给描述下方那个统一按钮，那里能一次说清会动到什么。
			//
			// `id` 与 `label` 就是原件的可访问名：它画成 `<label for=id>` + `<input id>`，少一个浏览器
			// 就报「表单字段没有标签」，所以两个都必须非空，`id` 还必须在本页唯一。
			const textField = (field) => {
				const key = pathKey(field.path);
				// 失焦校验的结论与整数越界共用原件的 invalid：原件会把说明换成这行红字。
				const reason = pathChecks[key];
				const invalidLabel = invalid === key ? t('invalidNumber') : invalidCopy(field, reason);
				return h(SettingsValueField, {
					key,
					id: `plugin-config-local-search-${key}`,
					label: t(field.labelKey),
					hint: t(field.hintKey),
					text: String(valueOf(field.path) ?? ''),
					overridden: false,
					invalid: reason !== undefined || invalid === key,
					invalidLabel,
					disabled,
					numeric: field.type === 'count',
					onEdit: (next) => edit(field.path, next, field.type === 'count'),
				});
			};

			const fieldNode = (field) => (field.type === 'choice'
				? h(ChoiceField, {
					key: pathKey(field.path),
					t,
					field,
					id: `plugin-config-local-search-${pathKey(field.path)}`,
					value: valueOf(field.path),
					invalid: invalid === pathKey(field.path),
					disabled,
					onEdit: (next) => edit(field.path, next, false),
				})
				: textField(field));

			/**
			 * 保存前问一次 Host：草稿里的地址能通、`es.exe` 路径真的存在。
			 *
			 * 校验只覆盖「能安全校验」的字段（Host 侧不 spawn 任何草稿路径）。返回 ok 就直接写；
			 * 失败时不写，只把结论挂出来。
			 *
			 * `hard` 区分两种失败：400（路径上没有文件 / 目录不存在 / 地址被拒）是值本身错了，
			 * 没有「稍后会好」的可能，给不出「仍然保存」；引擎不可用与请求失败是暂时的，可以强行保存。
			 * @returns 校验结论、是否硬错，与失败文案
			 */
			const verify = async (draft) => {
				const query = verifyQuery(draft, fields);
				if (query === '') return { ok: true };
				setCheck({ status: 'running' });
				let body;
				let response;
				try {
					response = await fetch(`${api(STATUS_ROUTE)}?${query}`, { cache: 'no-store' });
					body = await response.json().catch(() => undefined);
				} catch (error) {
					return { ok: false, reason: `${t('testFailed')}: ${error instanceof Error ? error.message : String(error)}` };
				}
				if (response.status === 400) {
					const reason = body?.code === 'ES_PATH_REJECTED' ? t('savePathMissing')
						: body?.code === 'ES_PATH_NOT_FILE' ? t('savePathNotFile')
							: body?.code === 'DIR_REJECTED' ? t('saveDirMissing')
								: body?.code === 'DIR_NOT_DIRECTORY' ? t('saveDirNotDir') : t('saveEndpointInvalid');
					return { ok: false, hard: true, reason };
				}
				if (!response.ok) return { ok: false, reason: `${t('testFailed')}: HTTP ${response.status}` };
				if (body?.ok === true) return { ok: true, drafts: body.drafts };
				const down = [body?.everything?.ok === false ? t('everythingDown') : '', body?.anytxt?.ok === false ? t('anytxtDown') : '']
					.filter((line) => line !== '');
				return { ok: false, reason: `${t('saveEngineDown')}${down.join(t('listSeparator'))}` };
			};

			/**
			 * 重置的原子写入：清掉引擎与上限，再按探测结果把 esPath 与 Anytxt 地址填回去。
			 *
			 * 它就是「把首用自动配置重跑一遍」。`scopes` 不在清空列表里（那是手填的机器路径）。
			 */
			const writeReset = async () => {
				if (form === undefined || resetInfo === undefined) return;
				setResetState({ status: 'running' });
				let probed;
				try {
					const response = await fetch(statusUrl(''), { cache: 'no-store' });
					probed = response.ok ? await response.json() : undefined;
				} catch {
					probed = undefined;
				}
				const ops = (resetInfo.clear ?? []).map((path) => ({ op: 'unset', path }));
				for (const fill of resetInfo.fills ?? []) {
					const value = fillValue(probed, fill.from);
					if (value === undefined) continue;
					// 探到的值与默认一致就不写：写一条等于默认的覆盖，只会让 profile 变脏。
					if (fill.default !== undefined && String(value) === String(fill.default)) continue;
					ops.push({ op: 'set', path: fill.path, value });
				}
				if (resetInfo.marker !== undefined) ops.push({ op: 'set', path: resetInfo.marker, value: true });
				let landed = false;
				try {
					landed = await form.mutate(ops);
				} catch {
					landed = false;
				}
				if (landed) {
					setStaged({});
					setPathChecks({});
				}
				setResetState({ status: landed ? 'done' : 'failed' });
			};

			/**
			 * 重置按钮：只负责开确认弹窗（或让没有 Modal 的部署点两下）。真写由弹窗里的确认触发。
			 */
			const runReset = () => {
				if (form === undefined || busy || resetInfo === undefined) return;
				if (dialogReady) {
					setDialog({ kind: 'reset' });
					return;
				}
				if (resetState.status !== 'confirm') {
					setResetState({ status: 'confirm' });
					return;
				}
				void writeReset();
			};

			/**
			 * @param force - 用户在弹窗里选了「仍然保存」，跳过这次校验直接写
			 */
			const save = async (force) => {
				if (form === undefined || busy || !dirty || invalid !== undefined) return;
				// 路径先改成标准写法再校验、再写：`d:/alpha/` 落盘的是 `D:\alpha`，草稿也跟着更新，
				// 所以用户看到的就是存进去的样子。
				const { next: normalized, changed } = normalizeStaged(staged, fields);
				let draft = normalized;
				if (changed) setStaged(draft);
				// 没有 Modal 的部署靠按钮上的「仍然保存」表达同一件事：第二次按就不再校验。
				const skipCheck = force === true || (dialogReady !== true && override === true);
				if (skipCheck !== true) {
					const result = await verify(draft);
					if (!result.ok) {
						// 校验的 running 必须在这里收掉：它会算进 `busy`，否则接下来的写入会被自己挡住。
						setCheck({ status: 'idle' });
						// 没有 Modal 的部署沿用页内那一行红字；硬错则不再把保存按钮改成「仍然保存」。
						if (!dialogReady) {
							setCheck({ status: 'failed', message: `${result.reason}${t('saveNoWrite')}` });
							setOverride(result.hard !== true);
							return;
						}
						setDialog(result.hard === true
							? { kind: 'blocked', message: `${result.reason}${t('fullStop')}` }
							: { kind: 'save-anyway', message: `${result.reason}${t('fullStop')}` });
						return;
					}
					// Host 会把草稿解析成磁盘上的真实写法（`d:/alpha` → `D:\Alpha`），回填后再落盘。
					const canonical = applyCanonical(draft, fields, result.drafts);
					if (canonical !== draft) {
						draft = canonical;
						setStaged(draft);
					}
				}
				setCheck({ status: 'idle' });
				setDialog(null);
				setSaving(true);
				setFailed(false);
				let landed = false;
				try {
					// 不显式带 revision：表单会用它知道的最新 revision 圈住这次写入，所以这个保存
					// 不会因为读到的是旧值而被判过期。
					landed = await form.mutate(operations(draft));
				} catch {
					landed = false;
				}
				setSaving(false);
				if (landed) {
					setStaged({});
					setOverride(false);
					setPathChecks({});
				} else {
					setFailed(true);
				}
			};

			/** 输入框里的 `es.exe` 路径；空串表示用已保存的（或自动查找）。 */
			const esPathDraft = () => {
				for (const field of fields.values()) {
					if (field.verifyPath !== true) continue;
					const entries = draftEntries(field, valueOf(field.path));
					return entries.length === 0 ? '' : entries[0][1];
				}
				return '';
			};

			const runProbe = async (field) => {
				if (probe.status === 'running') return;
				setProbe({ status: 'running' });
				const target = String(valueOf(field.path) ?? '').trim();
				try {
					// 连输入框里的 `es.exe` 路径一起交给 Host：它只查存在性，所以路径打错时这次
					// 测试会直接报出来，而不是拿已保存的那个（或自动找到的那个）报「正常」。
					const response = await fetch(statusUrl(target, esPathDraft()), { cache: 'no-store' });
					const body = await response.json().catch(() => undefined);
					if (response.status === 400) {
						if (body?.code === 'ANYTXT_URL_REJECTED') {
							setProbe({ status: 'rejected' });
							return;
						}
						// 路径的两种拒绝要分开说：不存在与「是个目录」是两种改法。
						if (body?.code === 'ES_PATH_REJECTED') {
							setProbe({ status: 'path-missing' });
							return;
						}
						if (body?.code === 'ES_PATH_NOT_FILE') {
							setProbe({ status: 'path-not-file' });
							return;
						}
					}
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					setProbe({ status: 'done', body });
				} catch (error) {
					setProbe({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
				}
			};

			/**
			 * 测试按钮：开弹窗并立刻探一次。没有 Modal 的部署把结果留在页内。
			 * @param field - 带 `probeEndpoint` 的那个字段
			 */
			const openProbe = (field) => {
				if (dialogReady) setDialog({ kind: 'probe', field });
				void runProbe(field);
			};

			/**
			 * 探测的单行结论：被拒的草稿、请求失败。
			 *
			 * 放进弹窗的 `description`，字号与「重置」「仍要保存？」的正文一致；探测跑完时没有
			 * 单行结论（那时正文是列表）。
			 * @returns 一行文字；没有时为 undefined
			 */
			const probeMessage = () => {
				if (probe.status === 'path-missing') return `${t('savePathMissing')}${t('fullStop')}`;
				if (probe.status === 'path-not-file') return `${t('savePathNotFile')}${t('fullStop')}`;
				if (probe.status === 'rejected') return t('testLocalOnly');
				if (probe.status === 'failed') return `${t('testFailed')}${t('colon')}${probe.message}${t('fullStop')}`;
				return undefined;
			};

			/**
			 * 探测结果的列表：每个引擎一行，失败的那行下面再挂一句可照做的修法。
			 * @returns 列表节点；探测没跑完时为空数组
			 */
			const probeBody = () => {
				if (probe.status !== 'done') return [];
				const rows = probeResult(t, probe.body);
				return [h('ul', { key: 'status', style: PROBE_LIST_STYLE }, rows.map((row) => h('li', {
					key: row.key,
					style: PROBE_ITEM_STYLE,
				},
					h('span', null, row.text),
					row.fix === undefined ? null : h('span', { key: 'fix', style: PROBE_FIX_STYLE },
						row.fix.href === undefined
							? row.fix.text
							: h('a', { href: row.fix.href, target: '_blank', rel: 'noreferrer noopener', style: LINK_STYLE }, row.fix.text)),
				)))];
			};

			/**
			 * 没有 `Modal` 的部署用的页内提示：列表或那一行结论，二者其一。
			 */
			const probeLines = () => {
				const body = probeBody();
				if (body.length > 0) return body;
				const message = probeMessage();
				return message === undefined ? [] : [h('p', { key: 'message', style: HINT_STYLE }, message)];
			};

			// 测试按钮只出现在带 `probeEndpoint` 的字段所在小节，且紧跟其网格：它回答的是那个
			// 地址的问题，不该随页面漂移。表单脏着也可用，因为它探测的是输入框里的值。
			// 有 Modal 的部署把结论放进弹窗；页内就不再重复一遍。
			const probeBlock = (section) => {
				const field = visibleFields(section).find((candidate) => candidate.probeEndpoint === true);
				if (field === undefined) return undefined;
				const block = [
					h('div', { key: 'action', style: { marginTop: '8px' } },
						h(Button, {
							variant: 'outline',
							size: 'sm',
							disabled,
							onClick: () => { openProbe(field); },
						}, probe.status === 'running' ? t('testing') : t('test')),
					),
				];
				if (!dialogReady) {
					const lines = probeLines();
					block.push(...(lines.length > 0 ? lines : [h('p', { key: 'message', style: HINT_STYLE }, t('testHint'))]));
				}
				return h('div', { key: 'probe' }, block);
			};

			/**
			 * 当前开着的那个弹窗。
			 *
			 * 全部用 primitives 的 `Modal`：它自己 portal 到 `document.body`，自带 Esc 关闭、Tab 焦点
			 * 陷阱与关闭后的焦点归还，所以本包仍然一行 CSS 都不发。`title` 同时是对话框的可访问名，
			 * `closeLabel` 是关闭按钮的名字，两个都得给。
			 * @returns 弹窗节点；没开或部署没有 `Modal` 时为 null
			 */
			const dialogNode = () => {
				if (!dialogReady || dialog === null) return null;
				const close = () => { setDialog(null); };
				const button = (key, variant, label, onClick, extra) => h(Button, {
					key, variant, onClick, ...extra,
				}, label);
				if (dialog.kind === 'reset') {
					return h(Modal, {
						key: 'dialog-reset',
						open: true,
						title: t('resetTitle'),
						closeLabel: t('close'),
						description: t('resetHint'),
						onClose: close,
						footer: [
							button('cancel', 'outline', t('cancel'), close),
							// 确认即关弹窗：进度由页面上那个按钮显示（重置中…），弹窗不该盖着一页按钮。
							button('confirm', 'primary', t('reset'), () => {
								setDialog(null);
								void writeReset();
							}),
						],
					});
				}
				// 硬错没有「稍后会好」的可能：说清是哪个值不行，只给关闭。
				if (dialog.kind === 'blocked') {
					return h(Modal, {
						key: 'dialog-blocked',
						open: true,
						title: t('saveBlockedTitle'),
						closeLabel: t('close'),
						description: dialog.message,
						onClose: close,
						footer: [button('close', 'primary', t('close'), close)],
					});
				}
				if (dialog.kind === 'save-anyway') {
					return h(Modal, {
						key: 'dialog-save-anyway',
						open: true,
						title: t('saveAnywayTitle'),
						closeLabel: t('close'),
						description: dialog.message,
						onClose: close,
						footer: [
							button('cancel', 'outline', t('cancel'), close),
							button('confirm', 'primary', t('saveAnyway'), () => { void save(true); }),
						],
					});
				}
				const body = probeBody();
				return h(Modal, {
					key: 'dialog-probe',
					open: true,
					title: t('test'),
					closeLabel: t('close'),
					// 单行结论走 description（和别的弹窗正文同一个字号），探测结果走列表。
					description: probe.status === 'running' ? t('testing') : probeMessage(),
					onClose: close,
					children: body.length > 0 ? h('div', { key: 'body', style: PROBE_BODY_STYLE }, body) : undefined,
					footer: [
						button('again', 'outline', t('testAgain'), () => { void runProbe(dialog.field); }, { disabled: probe.status === 'running' }),
						button('close', 'primary', t('close'), close),
					],
				});
			};

			const sectionNode = (section) => {
				const backends = section.backends ?? [];
				const header = backends.length === 0 ? undefined : h('div', { style: SELECTOR_STYLE },
					h(SegmentedControl, {
						// 原件拿它拼每个选项的 DOM id（`<id>-<值>`）与 `aria-controls`；不给就是
						// `undefined-everything`，两个能力节的选项还会撞 id。
						id: `plugin-config-local-search-${section.id}-backend`,
						value: backendOf(section),
						options: backends.map((backend) => ({
							value: backend.name,
							label: backend.labelKey === undefined ? backend.name : t(backend.labelKey),
						})),
						onChange: (next) => edit(section.backendPath, next, false),
						label: t(section.titleKey),
						disabled,
					}));
				return h(Section, {
					key: section.id,
					id: `plugin-config-local-search-${section.id}`,
					title: t(section.titleKey),
					header,
					grid: gridStyle(wide),
					footer: probeBlock(section),
				}, visibleFields(section).map((field) => cell(field)));
			};

			// 描述还没到手时，表单至少要有内容：加载中一行，失败一行带重试。
			let children;
			if (described.status === 'failed') {
				children = [h('p', { key: 'describe', role: 'status', style: HINT_STYLE },
					`${t('describeFailed')} ${described.message} `,
					h(Button, {
						variant: 'ghost',
						size: 'sm',
						onClick: () => {
							setDescribed({ status: 'idle' });
							setReload((count) => count + 1);
						},
					}, t('retry')))];
			} else if (described.status === 'done') {
				const resetButton = h(Button, {
					key: 'reset',
					variant: 'primary',
					size: 'sm',
					disabled,
					onClick: () => { runReset(); },
				}, resetState.status === 'running'
					? t('resetting')
					: resetState.status === 'confirm' ? t('resetConfirm') : t('reset'));
				children = [
					...(resetInfo === undefined ? [] : [h('div', { key: 'reset-1', style: RESET_TOP_STYLE }, resetButton)]),
					...sections.map(sectionNode),
					h('p', { key: 'note', style: HINT_STYLE }, t('note')),
				];
				if (resetState.status === 'confirm') {
					children = [...children, h('p', { key: 'reset-hint', style: NOTICE_STYLE }, t('resetHint'))];
				} else if (resetState.status === 'done') {
					children = [...children, h('p', { key: 'reset-done', style: NOTICE_STYLE }, t('resetDone'))];
				} else if (resetState.status === 'failed') {
					children = [...children, h('p', { key: 'reset-failed', role: 'alert', style: NOTICE_STYLE }, t('resetFailed'))];
				}
			} else {
				children = [h('p', { key: 'describe', role: 'status', style: HINT_STYLE }, t('describeLoading'))];
			}
			// 没有 Modal 的部署才把校验结论留在页内；有弹窗时结论就在弹窗里。
			if (check.status === 'failed') {
				children = [...children, h('p', { key: 'check', role: 'alert', style: NOTICE_STYLE }, check.message)];
			}
			// 启动时的迁移或自动配置写回失败：原因只有这一处看得见（日志里的那条用户不会去翻）。
			const autoconfigError = described.status === 'done' ? described.body.autoconfig?.error : undefined;
			if (typeof autoconfigError === 'string' && autoconfigError !== '') {
				children = [...children, h('p', { key: 'autoconfig', role: 'alert', style: NOTICE_STYLE },
					`${t('autoconfigFailed')}${autoconfigError}`)];
			}
			const modal = dialogNode();
			if (modal !== null) children = [...children, modal];

			return h(SettingsForm, {
				labels: {
					unavailable: t('unavailable'),
					readOnly: t('readOnly'),
					saveFailed: t('saveFailed'),
					save: override ? t('saveAnyway') : t('save'),
					saving: t('saving'),
				},
				state: {
					available: form !== undefined,
					writable,
					dirty,
					invalid: invalid !== undefined,
					saving,
					failed,
				},
				onSave: () => { void save(); },
				// SettingsForm 只在卸载时调它；草稿属于这个组件实例，重新挂载本来就是干净的。
				onDiscard: () => { setStaged({}); },
				children,
			});
		}

		/**
		 * 首用探测发现引擎不可用时的提示。
		 *
		 * 只在 primitives 提供 `Toast` 时出现：本包不发布 CSS，没有 `Toast` 的部署就干脆不提示，
		 * 而不是自己画一个带内联样式的浮层。
		 */
		function EngineNotice(props) {
			const { t, engines, onDone } = props;
			if (Toast === undefined || Toast === null) return null;
			return h(Toast, { text: `${t('noticeEnginesDown')}${engines.join(', ')}`, holdMs: 6000, onDone });
		}

		/** 这个浏览器会话里提示过没有。 */
		function noticeSeen() {
			try {
				return window.sessionStorage?.getItem(NOTICE_SEEN_KEY) === '1';
			} catch {
				return false;
			}
		}

		function markNoticeSeen() {
			try {
				window.sessionStorage?.setItem(NOTICE_SEEN_KEY, '1');
			} catch {
				// 隐私模式下 sessionStorage 会抛，提示退化成每次启动都出现。
			}
		}

		/**
		 * 挂载配置卡进 Plugins 页的 Official plugins 组，并在首用探测报错时提示一次。
		 * @param ctx - 浏览器插件上下文
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-search: config dictionary');
			ctx.effect(() => ctx.slots.inject('plugins.item', () => ctx.slots.register({
				name: 'plugins.item',
				id: ITEM_ID,
				order: 100,
				label: () => t('itemLabel'),
				locale: NS,
			}, ConfigPage)), 'local-search: config card');
			ctx.effect(() => engineNotice(ctx, t), 'local-search: engine notice');
		}

		/**
		 * 等首用探测结束，若报告有引擎不可用且本会话还没提示过，就在 `shell.overlay` 里提示一次。
		 *
		 * 探测在 Host 侧异步跑，所以这里按小间隔轮询 describe，直到 `autoconfig.pending` 变 false
		 * 或轮询次数用完；中途任何失败都安静退出。
		 * @param ctx - 浏览器插件上下文
		 * @param t - 字典查找
		 * @returns 清理函数
		 */
		function engineNotice(ctx, t) {
			let disposed = false;
			let disposeSlot;
			let timer;

			const stop = () => {
				disposed = true;
				if (timer !== undefined) clearTimeout(timer);
				disposeSlot?.();
				disposeSlot = undefined;
			};

			const show = (engines) => {
				// 没有 Toast 就不注册任何东西：本包不发 CSS，画不出一个像样的提示。
				if (Toast === undefined || Toast === null) return false;
				if (typeof ctx.slots?.inject !== 'function') return false;
				try {
					disposeSlot = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
						name: 'shell.overlay',
						id: 'fishdivinity-local-search.engine-notice',
						order: 900,
						locale: NS,
					}, () => h(EngineNotice, { t, engines, onDone: stop })));
					return true;
				} catch {
					// 没有这个槽位的部署就不提示；也不会把「已提示」标上，免得换一个部署后永远不提示。
					return false;
				}
			};

			const tick = async (attempt) => {
				if (disposed) return;
				let body;
				try {
					const response = await fetch(describeUrl(), { cache: 'no-store' });
					if (!response.ok || disposed) return;
					body = await response.json();
				} catch {
					return;
				}
				const autoconfig = body?.autoconfig;
				if (autoconfig === undefined || disposed) return;
				if (autoconfig.pending === true && attempt < NOTICE_POLL_LIMIT) {
					timer = setTimeout(() => { void tick(attempt + 1); }, NOTICE_POLL_MS);
					return;
				}
				const failures = Array.isArray(autoconfig.failures) ? autoconfig.failures : [];
				if (failures.length === 0 || noticeSeen()) return;
				if (show(failures.map((failure) => String(failure.engine ?? 'engine')))) markNoticeSeen();
			};

			timer = setTimeout(() => { void tick(0); }, NOTICE_POLL_MS);
			return stop;
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.NS = NS;
		exports.ITEM_ID = ITEM_ID;
		exports.DESCRIBE_ROUTE = DESCRIBE_ROUTE;
		exports.STATUS_ROUTE = STATUS_ROUTE;
		exports.DRAFT_PARAM = DRAFT_PARAM;
		exports.DRAFT_PATH_PARAM = DRAFT_PATH_PARAM;
		exports.DRAFT_DIR_PARAM = DRAFT_DIR_PARAM;
		exports.ConfigPage = ConfigPage;
		// 暴露出来，让测试能证明它们与 Host 的规则一致 / 能把草稿翻成嵌套路径。
		exports.LOOPBACK_HOSTS = LOOPBACK_HOSTS;
		exports.internals = {
			pathKey, pathValue, operations, invalidField, choiceValue, verifyQuery, fillValue, EngineNotice,
			normalizeWinPath, normalizeWinPaths, normalizeStaged,
		};
		// 样式常量也暴露出来，测试才能钉住「用的是主题真有的 token」。
		exports.styles = { NOTICE_STYLE, LINK_STYLE, gridStyle, GRID_MAX_WIDTH, WIDE_QUERY, CELL_STYLE, RESET_TOP_STYLE };
		exports.en = en;
		exports.zh = zh;
		return module.exports;
	}
});

/**
 * dsh-local-search browser half — the plugin's configuration page.
 *
 * It registers into `plugins.item`, the list the Plugins page shows as the
 * **Official plugins** group, the same way `dsh-github` contributes its GitHub
 * card: one card, click it, the plugin's own page opens.
 *
 * The card's `id` is what the page resolves the form with
 * (`formFor(openItem.id)`), and that lookup only answers for an id the Host
 * serves as a settings namespace — which is the row id this bundle's patch
 * declares. So `id` must stay `fishdivinity-local-search`; the package name
 * would resolve no form.
 *
 * The page receives `{ view, form }`: `view: 'summary'` is the card's one-liner,
 * `view: 'page'` the form with its save control.
 *
 * Every control comes from `@deepseek-ai/dsh-client-ui-primitives`, which reads
 * the active theme's `--dsw-*` tokens, so a UI skin (for example the
 * maid-atelier skin) restyles the page without this package shipping CSS. The
 * layout follows the official settings pages: sections with a small heading and
 * a responsive field grid, so fields sit side by side instead of one per row.
 *
 * The Test control cannot call the local Anytxt JSON-RPC from the page (a
 * cross-origin POST is refused by both sides), so it asks the Host's read-only
 * probe route declared in `lib/route.js`.
 *
 * This file is the shipped client bundle, not its source: the client module
 * system executes it as a classic script in the lazy-CJS factory format, so it
 * declares no ESM import or export.
 */
window.__ModuleLoader__.load({
	id: '@fishdivinity/dsh-local-search',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const { createElement: h, useState } = require('react');
		const {
			Button, SegmentedControl, SettingsForm, SettingsValueField, Tag,
		} = require('@deepseek-ai/dsh-client-ui-primitives');

		/** Dictionary namespace owned by this plugin. */
		const NS = 'localSearchConfig';
		/** The card id, which must be the settings namespace = the row id the bundle patch declares. */
		const ITEM_ID = 'fishdivinity-local-search';
		/** The Host's read-only probe route, resolved against this page's own base URI. */
		const STATUS_ROUTE = '/dsh-local-search/api/status';
		/** Client services this half requires; both are provided by the web shell. */
		const inject = ['slots', 'locale'];

		/** Where each engine is installed from. This plugin never downloads them. */
		const DOWNLOADS = {
			everything: 'https://www.voidtools.com/downloads/',
			anytxt: 'https://anytxt.net/download/',
		};

		/** Code pages the page offers. The Host accepts any TextDecoder label. */
		const ENCODINGS = ['gbk', 'utf-8'];

		/**
		 * The segment a saved code page selects. 0.1 accepted any label, so an
		 * old `utf8` (or `gb18030`) must land on the right segment instead of
		 * showing GBK and then rewriting the value on save.
		 * @param value - the saved label
		 * @returns `gbk` or `utf-8`
		 */
		function normalizeEncoding(value) {
			const label = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
			return label === 'utf8' || label === 'utf' ? 'utf-8' : 'gbk';
		}

		/** The editable fields. `count` fields are whole numbers with a hard cap. */
		const FIELDS = {
			esPath: { key: 'esPath', kind: 'text' },
			esEncoding: { key: 'esEncoding', kind: 'choice' },
			anytxtUrl: { key: 'anytxtUrl', kind: 'text' },
			workspaceRoot: { key: 'workspaceRoot', kind: 'text' },
			workRoot: { key: 'workRoot', kind: 'text' },
			personalRoot: { key: 'personalRoot', kind: 'text' },
			allRoots: { key: 'allRoots', kind: 'text' },
			maxResults: { key: 'maxResults', kind: 'count', max: 100 },
			readMaxChars: { key: 'readMaxChars', kind: 'count', max: 20000 },
		};

		/** Per-field copy: [label, hint]. */
		const FIELD_COPY = {
			esPath: {
				en: ['es.exe path', 'Absolute path to es.exe; empty auto-detects PATH and the usual install folders.'],
				zh: ['es.exe 路径', 'es.exe 的绝对路径；留空则自动从 PATH 与常见安装目录查找。'],
			},
			esEncoding: {
				en: ['es.exe output encoding', 'Code page used to decode es.exe output: GBK for a zh-CN console, UTF-8 otherwise.'],
				zh: ['es.exe 输出编码', '解码 es.exe 输出所用的代码页：简中控制台用 GBK，其余用 UTF-8。'],
			},
			anytxtUrl: {
				en: ['Anytxt endpoint', 'This machine only (127.0.0.1 / localhost); an address ending in :9920 also tries :9921.'],
				zh: ['Anytxt 地址', '只允许本机地址（127.0.0.1 / localhost）；以 :9920 结尾时还会自动尝试 :9921。'],
			},
			workspaceRoot: {
				en: ['Workspace root', 'Root for scope=workspace; empty follows the session working directory.'],
				zh: ['工作区根', 'scope=workspace 的根；留空跟随会话工作目录。'],
			},
			workRoot: {
				en: ['Work root', 'Root for scope=work; the scope is unavailable while this is empty.'],
				zh: ['工作根', 'scope=work 的根；留空时该 scope 不可用。'],
			},
			personalRoot: {
				en: ['Personal root', 'Root for scope=personal; the scope is unavailable while this is empty.'],
				zh: ['个人根', 'scope=personal 的根；留空时该 scope 不可用。'],
			},
			allRoots: {
				en: ['All-scope roots', 'Semicolon-separated directories for scope=all; empty uses C: and D: when they exist.'],
				zh: ['全局检索根', 'scope=all 使用的目录，分号分隔；留空使用存在的 C: 与 D:。'],
			},
			maxResults: {
				en: ['Results per call', 'Default result cap for both search tools; 1–100.'],
				zh: ['每次结果数', '两个检索工具的默认结果上限；1–100。'],
			},
			readMaxChars: {
				en: ['Read window (characters)', 'Default window for local_search_read; 1–20000.'],
				zh: ['读取窗口（字符）', 'local_search_read 的默认窗口；1–20000。'],
			},
		};

		/** Type styles from theme tokens; a skin owns every colour and size it overrides. */
		const H3_STYLE = { margin: 0, fontSize: '13px', fontWeight: '600', lineHeight: '1.5', color: 'var(--dsw-alias-label-primary)' };
		const LABEL_STYLE = { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' };
		const HINT_STYLE = { margin: '4px 0 0', fontSize: '12px', lineHeight: '1.6', color: 'var(--dsw-alias-label-secondary)' };
		const LINK_STYLE = { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'none' };
		const ROW_STYLE = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' };
		/**
		 * The field grid. A 460px minimum keeps two columns on a wide page and one
		 * on a narrow one, so four paths read as two rows instead of four squeezed
		 * columns; the four-path section is why the minimum is not the official
		 * page's 220px.
		 */
		const GRID_STYLE = {
			display: 'grid',
			gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))',
			gap: '16px',
			marginTop: '8px',
		};
		const SECTION_STYLE = { minWidth: 0, padding: '16px 0' };

		function dictionary(copy) {
			const words = {
				description: copy('只读的 Everything 文件名检索与 Anytxt 文档内容检索。', 'Read-only Everything filename search and Anytxt document-content search.'),
				itemLabel: copy('本地搜索', 'Local Search'),
				sectionEverything: copy('Everything（文件名检索）', 'Everything (file names)'),
				sectionAnytxt: copy('Anytxt（文档内容检索）', 'Anytxt (document contents)'),
				sectionScopes: copy('检索范围', 'Search scopes'),
				sectionLimits: copy('上限', 'Limits'),
				note: copy(
					'单次调用超时仍留在 profile 的 YAML：工具注册时就固定了截止时间。',
					'The per-call timeout stays in the profile YAML: each tool fixes its deadline when it registers.',
				),
				overridden: copy('本页设置', 'Set on this page'),
				reset: copy('重置', 'Reset'),
				invalidValue: copy('这个值不合法。', 'Not a valid value.'),
				invalidNumber: copy('请填范围内的整数。', 'Enter a whole number in range.'),
				unavailable: copy(
					'当前部署没有提供本插件的设置命名空间，请改在 profile 的 cordis.patch.yml 里配置。',
					"This deployment does not serve this plugin's settings; set the values in the profile's cordis.patch.yml instead.",
				),
				readOnly: copy('本部署的设置为只读。', 'This deployment stores settings read-only.'),
				saveFailed: copy('宿主没有接受这些值。', 'The Host did not accept these values.'),
				save: copy('保存', 'Save'),
				saving: copy('保存中…', 'Saving…'),
				encodingGbk: copy('GBK（简中）', 'GBK (zh-CN)'),
				encodingUtf8: 'UTF-8',
				test: copy('测试连接', 'Test connection'),
				testing: copy('测试中…', 'Testing…'),
				testHint: copy(
					'用上面输入框里的地址试一次，不用先保存；只探测，不改配置。',
					'Probes the address above without saving it first; changes nothing.',
				),
				testLocalOnly: copy(
					'地址必须是本机 http(s)：127.0.0.1、localhost 或 [::1]。',
					'The address must be a local http(s) url: 127.0.0.1, localhost or [::1].',
				),
				testFailed: copy('测试请求失败', 'The test request failed'),
				testWhere: copy('测试请求发往', 'The test request goes to'),
				everythingOk: copy('Everything 正常', 'Everything: OK'),
				everythingDown: copy('Everything 不可用', 'Everything: DOWN'),
				anytxtOk: copy('Anytxt 正常', 'Anytxt: OK'),
				anytxtDown: copy('Anytxt 不可达', 'Anytxt: DOWN'),
				downloadEverything: copy('下载 Everything', 'Download Everything'),
				downloadAnytxt: copy('下载 Anytxt', 'Download Anytxt'),
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
		 * A route under this page's own base URI, so a deployment mounted below
		 * the origin root still reaches the Host's route.
		 * @param path - absolute path on the Host
		 * @returns the request path
		 */
		function api(path) {
			const relative = String(path).replace(/^\/+/, '');
			if (typeof document === 'undefined') return `/${relative}`;
			return new URL(relative, document.baseURI).pathname;
		}

		/**
		 * The probe request for the address currently in the field. A draft rides
		 * the query, so testing never needs a save first; the Host accepts a draft
		 * only as a loopback `http(s)` URL.
		 * @param draft - the endpoint as typed, or empty to probe the saved value
		 * @returns the request path, query included
		 */
		function statusUrl(draft) {
			const path = api(STATUS_ROUTE);
			const trimmed = String(draft ?? '').trim();
			if (trimmed === '') return path;
			return `${path}?anytxtUrl=${encodeURIComponent(trimmed)}`;
		}

		/**
		 * The staged edits as one atomic operation list. A cleared field is an
		 * `unset`, so it falls back to the profile layer instead of pinning an
		 * empty override.
		 * @param staged - key to `{ op: 'set', text }` or `{ op: 'unset' }`
		 * @returns the operations a save submits
		 */
		function operations(staged) {
			return Object.entries(staged).map(([key, entry]) => {
				if (entry.op === 'unset') return { op: 'unset', path: [key] };
				const field = FIELDS[key];
				return { op: 'set', path: [key], value: field.kind === 'count' ? Number(entry.text) : entry.text };
			});
		}

		/**
		 * Whether a value is an `http(s)` URL on this machine — the only shape the
		 * Host accepts, so the field refuses the same values.
		 * @param value - candidate endpoint
		 * @returns true for a loopback `http(s)` URL
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
			return host === '127.0.0.1' || host === '::1' || host === 'localhost';
		}

		/**
		 * The first staged field a save would have to refuse.
		 * @param staged - key to staged edit
		 * @returns the key, or undefined when every draft is acceptable
		 */
		function invalidField(staged) {
			for (const [key, entry] of Object.entries(staged)) {
				if (entry.op === 'unset') continue;
				const trimmed = String(entry.text).trim();
				if (key === 'anytxtUrl' && trimmed !== '' && !isLoopbackUrl(trimmed)) return key;
				const field = FIELDS[key];
				if (field.kind === 'count') {
					const value = Number(entry.text);
					if (!Number.isInteger(value) || value < 1 || value > field.max) return key;
				}
			}
			return undefined;
		}

		/**
		 * Render the probe result: one line per engine, plus where to install an
		 * engine that is missing. Nothing here installs anything.
		 * @param t - dictionary lookup
		 * @param body - the route's JSON answer
		 * @returns the result text and any guidance links
		 */
		function probeResult(t, body) {
			const everything = body.everything ?? {};
			const anytxt = body.anytxt ?? {};
			// One line, one clause per engine: a passing engine needs its version, a
			// failing one needs its code, and neither needs its prose message.
			const parts = [
				everything.ok
					? `${t('everythingOk')}${everything.version ? ` ${everything.version}` : ''}`
					: `${t('everythingDown')} (${everything.code ?? 'UNKNOWN'})`,
				anytxt.ok
					? t('anytxtOk')
					: `${t('anytxtDown')} (${anytxt.code ?? 'UNKNOWN'})`,
			];
			const guidance = [];
			if (!everything.ok) guidance.push({ key: 'everything', text: t('downloadEverything'), href: DOWNLOADS.everything });
			if (!anytxt.ok) guidance.push({ key: 'anytxt', text: t('downloadAnytxt'), href: DOWNLOADS.anytxt });
			return { text: parts.join(' · '), guidance };
		}

		/**
		 * One section: a small heading, then fields on the official grid.
		 * @param props - title, heading id, whether to use the grid, and the fields
		 * @returns the section element
		 */
		function Section(props) {
			return h('section', { style: SECTION_STYLE, 'aria-labelledby': props.id },
				h('h3', { id: props.id, style: H3_STYLE }, props.title),
				props.grid === false
					? h('div', { style: { marginTop: '8px' } }, props.children)
					: h('div', { style: GRID_STYLE }, props.children),
			);
		}

		/**
		 * The encoding field. The value set is closed, so it is a control instead
		 * of a text field the user could mistype into a silent UTF-8 fallback.
		 */
		function EncodingField(props) {
			const { t, id, value, overridden, disabled, onChange, onReset } = props;
			const options = ENCODINGS.map((encoding) => ({
				value: encoding,
				label: encoding === 'gbk' ? t('encodingGbk') : t('encodingUtf8'),
			}));
			return h('div', { style: { minWidth: 0 } },
				h('div', { style: ROW_STYLE },
					h('span', { style: LABEL_STYLE }, t('esEncodingLabel')),
					overridden ? h(Tag, { tone: 'neutral' }, t('overridden')) : null,
					overridden
						? h(Button, { variant: 'ghost', size: 'sm', disabled, onClick: onReset }, t('reset'))
						: null,
				),
				h('div', { style: { marginTop: '6px' } },
					h(SegmentedControl, {
						id,
						value: normalizeEncoding(value),
						options,
						onChange,
						label: t('esEncodingLabel'),
						disabled,
					}),
				),
				h('p', { style: HINT_STYLE }, t('esEncodingHint')),
			);
		}

		/**
		 * Render the configuration form shared by both surfaces.
		 * @param props - locale, view, and the configuration form
		 * @returns the page's React node
		 */
		function ConfigPage(props) {
			const { t, form, view } = props;
			const [staged, setStaged] = useState({});
			const [saving, setSaving] = useState(false);
			const [failed, setFailed] = useState(false);
			const [probe, setProbe] = useState({ status: 'idle' });

			// A summary render receives no form, so it must not claim a value state.
			if (view === 'summary') return h('span', null, t('description'));

			// A deployment whose primitives predate one of these renders the
			// unavailable line instead of throwing inside the host page's tree.
			// Every entry must be present, but not a plain function: `Button` is a
			// `forwardRef` object, so a typeof check would reject every deployment.
			const primitivesReady = [SettingsForm, SettingsValueField, Button, SegmentedControl, Tag]
				.every((primitive) => primitive !== undefined && primitive !== null);
			if (!primitivesReady) {
				return h('p', { role: 'status' }, t('unavailable'));
			}

			const values = form?.state.value ?? {};
			const user = form?.state.user ?? {};
			const writable = form?.state.writable ?? false;
			const invalid = invalidField(staged);
			const dirty = Object.keys(staged).length > 0;
			const busy = saving || probe.status === 'running';
			const disabled = !writable || busy;

			const edit = (key, text) => setStaged((previous) => ({ ...previous, [key]: { op: 'set', text } }));
			// Reset toggles: pressing it again puts the field back to its edited
			// state, so a staged reset is never a trap.
			const reset = (key) => setStaged((previous) => {
				if (previous[key]?.op === 'unset') {
					const next = { ...previous };
					delete next[key];
					return next;
				}
				return { ...previous, [key]: { op: 'unset', text: '' } };
			});
			const valueOf = (key) => {
				const entry = staged[key];
				return entry === undefined ? String(values[key] ?? '') : entry.text;
			};
			// The badge and the reset offer follow the saved user layer, not the
			// staged edit: hiding them the moment a reset is staged would leave no
			// way back before saving.
			const overriddenOf = (key) => Object.prototype.hasOwnProperty.call(user, key);

			const textField = (key) => h(SettingsValueField, {
				key,
				id: `plugin-config-local-search-${key}`,
				label: t(`${key}Label`),
				hint: t(`${key}Hint`),
				text: valueOf(key),
				overridden: overriddenOf(key),
				invalid: invalid === key,
				overriddenLabel: t('overridden'),
				resetLabel: t('reset'),
				invalidLabel: t(FIELDS[key].kind === 'count' ? 'invalidNumber' : 'invalidValue'),
				disabled,
				numeric: FIELDS[key].kind === 'count',
				onEdit: (next) => edit(key, next),
				onReset: () => reset(key),
			});

			// The field primitive draws its row separator with `.field + .field`, which
			// would paint a half-width rule inside a grid cell. Every field therefore
			// gets a plain wrapper, the way the official subagent page does it.
			const cell = (key, node) => h('div', { key, style: { minWidth: 0 } }, node);

			const save = async () => {
				if (form === undefined || busy || !dirty || invalid !== undefined) return;
				setSaving(true);
				setFailed(false);
				let landed = false;
				try {
					// No explicit revision: the form fences the write with the latest one
					// it knows, so this save cannot be rejected as stale by an older read.
					landed = await form.mutate(operations(staged));
				} catch {
					landed = false;
				}
				setSaving(false);
				if (landed) setStaged({});
				else setFailed(true);
			};

			const runProbe = async () => {
				if (probe.status === 'running') return;
				setProbe({ status: 'running' });
				const target = valueOf('anytxtUrl');
				try {
					const response = await fetch(statusUrl(target), { cache: 'no-store' });
					const body = await response.json().catch(() => undefined);
					if (response.status === 400 && body?.code === 'ANYTXT_URL_REJECTED') {
						setProbe({ status: 'rejected' });
						return;
					}
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					setProbe({ status: 'done', body });
				} catch (error) {
					setProbe({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
				}
			};

			// The Test control sits in the Anytxt field's own cell: it answers a
			// question about that endpoint, so it must not drift down the page. It
			// stays enabled while the form is dirty, because it probes the value in
			// the field rather than the stored one.
			const probeBlock = [
				h('div', { key: 'action', style: { marginTop: '8px' } },
					h(Button, {
						variant: 'outline',
						size: 'sm',
						disabled,
						onClick: () => { void runProbe(); },
					}, probe.status === 'running' ? t('testing') : t('test')),
				),
			];
			if (probe.status === 'done') {
				const result = probeResult(t, probe.body);
				probeBlock.push(h('p', { key: 'message', style: HINT_STYLE }, result.text));
				if (result.guidance.length > 0) {
					probeBlock.push(h('p', { key: 'guidance', style: HINT_STYLE }, result.guidance.map((line, index) => [
						index > 0 ? ' · ' : '',
						h('a', { key: line.key, href: line.href, target: '_blank', rel: 'noreferrer noopener', style: LINK_STYLE }, line.text),
					])));
				}
			} else if (probe.status === 'rejected') {
				probeBlock.push(h('p', { key: 'message', style: HINT_STYLE }, t('testLocalOnly')));
			} else if (probe.status === 'failed') {
				probeBlock.push(h('p', { key: 'message', style: HINT_STYLE },
					`${t('testFailed')}: ${probe.message}`, ' ',
					h('span', null, `${t('testWhere')} ${api(STATUS_ROUTE)}`)));
			} else {
				probeBlock.push(h('p', { key: 'message', style: HINT_STYLE }, t('testHint')));
			}

			return h(SettingsForm, {
				labels: {
					unavailable: t('unavailable'),
					readOnly: t('readOnly'),
					saveFailed: t('saveFailed'),
					save: t('save'),
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
				// SettingsForm calls this only on unmount; the draft belongs to this
				// component instance, so a fresh mount starts clean either way.
				onDiscard: () => { setStaged({}); },
				children: [
					h(Section, { key: 'everything', id: 'plugin-config-local-search-everything', title: t('sectionEverything') }, [
						cell('esPath', textField('esPath')),
						cell('esEncoding', h(EncodingField, {
							t,
							id: 'plugin-config-local-search-esEncoding',
							value: valueOf('esEncoding'),
							overridden: overriddenOf('esEncoding'),
							disabled,
							onChange: (next) => edit('esEncoding', next),
							onReset: () => reset('esEncoding'),
						})),
					]),
					h(Section, {
						key: 'anytxt',
						id: 'plugin-config-local-search-anytxt',
						title: t('sectionAnytxt'),
						grid: false,
					}, [
						cell('anytxt', [textField('anytxtUrl'), ...probeBlock]),
					]),
					h(Section, { key: 'scopes', id: 'plugin-config-local-search-scopes', title: t('sectionScopes') }, [
						cell('workspaceRoot', textField('workspaceRoot')),
						cell('workRoot', textField('workRoot')),
						cell('personalRoot', textField('personalRoot')),
						cell('allRoots', textField('allRoots')),
					]),
					h(Section, { key: 'limits', id: 'plugin-config-local-search-limits', title: t('sectionLimits') }, [
						cell('maxResults', textField('maxResults')),
						cell('readMaxChars', textField('readMaxChars')),
					]),
					h('p', { key: 'note', style: HINT_STYLE }, t('note')),
				],
			});
		}

		/**
		 * Mount the configuration card into the Plugins page's Official plugins
		 * group, the way dsh-github contributes its card.
		 * @param ctx - the browser plugin context
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
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.NS = NS;
		exports.ITEM_ID = ITEM_ID;
		exports.STATUS_ROUTE = STATUS_ROUTE;
		exports.ConfigPage = ConfigPage;
		exports.en = en;
		exports.zh = zh;
		return module.exports;
	}
});

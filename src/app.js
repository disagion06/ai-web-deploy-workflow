'use strict';
/* ============================================================================
 * 设计稿上线助手 · 渲染层
 * ----------------------------------------------------------------------------
 * 只通过 window.dd 调用主进程（契约见 docs/IPC_CONTRACT.md，冻结 v1）。
 * 原生 ES2020，无框架、无构建、无外部资源；所有用户数据都用 textContent 插入。
 * ==========================================================================*/
(function () {
  'use strict';

  /* ==========================================================================
   * 0. 桥接兜底
   * ========================================================================*/
  const dd = (typeof window !== 'undefined' && window.dd) ? window.dd : null;

  function showFatal(msg) {
    const host = document.getElementById('fatal');
    const p = document.getElementById('fatalMsg');
    if (p) p.textContent = msg;
    if (host) host.classList.remove('hidden');
    const app = document.getElementById('app');
    if (app) app.setAttribute('aria-hidden', 'true');
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /* ==========================================================================
   * 1. 通用工具
   * ========================================================================*/
  function h(tag, opts, kids) {
    const node = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) node.className = opts.cls;
    if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (k) {
        const v = opts.attrs[k];
        if (v === null || v === undefined || v === false) return;
        node.setAttribute(k, String(v));
      });
    }
    if (opts.on) {
      Object.keys(opts.on).forEach(function (k) { node.addEventListener(k, opts.on[k]); });
    }
    if (kids !== undefined && kids !== null) appendAll(node, kids);
    return node;
  }

  function appendAll(parent, kids) {
    const list = Array.isArray(kids) ? kids : [kids];
    list.forEach(function (k) {
      if (k === null || k === undefined || k === false) return;
      parent.appendChild((typeof k === 'string' || typeof k === 'number') ? document.createTextNode(String(k)) : k);
    });
    return parent;
  }

  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function spinner(extra) {
    return h('span', { cls: 'spinner' + (extra ? ' ' + extra : ''), attrs: { 'aria-hidden': 'true' } });
  }

  function fmtBytes(n) {
    let v = Number(n);
    if (!isFinite(v) || v < 0) v = 0;
    if (v < 1024) return v + ' B';
    const kb = v / 1024;
    if (kb < 1024) return round2(kb) + ' KB';
    const mb = kb / 1024;
    if (mb < 1024) return round2(mb) + ' MB';
    return round2(mb / 1024) + ' GB';
  }
  function round2(v) {
    return String(Math.round(v * 100) / 100);
  }

  function fmtTime(ts) {
    let d;
    if (ts === undefined || ts === null) d = new Date();
    else if (typeof ts === 'number') d = new Date(ts);
    else d = new Date(ts);
    if (isNaN(d.getTime())) return '--:--:--';
    const p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function dirname(p) {
    const s = String(p || '').replace(/[\\/]+$/, '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i > 0 ? s.slice(0, i) : s;
  }
  function isHtmlPath(p) { return /\.html?$/i.test(String(p || '')); }
  function basename(p) {
    const s = String(p || '').replace(/[\\/]+$/, '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function slugRepoName(name) {
    let s = String(name || '');
    s = s.replace(/[^A-Za-z0-9\-_]/g, '');   // 只保留 [A-Za-z0-9-_]
    s = s.toLowerCase();
    s = s.replace(/-{2,}/g, '-').replace(/^-+/, '').replace(/-+$/, '');  // 去掉首尾连字符
    return s || 'my-portfolio';
  }

  function toast(msg, kind) {
    const host = document.getElementById('toastHost');
    if (!host) return;
    const node = h('div', { cls: 'toast' + (kind ? ' ' + kind : ''), text: msg, attrs: { role: 'status' } });
    host.appendChild(node);
    window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 3600);
  }

  function err(res) {
    if (res && res.error) return res.error;
    return { code: 'E_UNKNOWN', message: '操作失败，未返回错误详情', tip: null };
  }
  function errText(e) {
    if (!e) return '未知错误';
    return e.message || e.code || String(e);
  }

  /* 在按钮下方渲染内联错误条（不做整页重绘） */
  function inlineErrorBox(error) {
    if (!error) return null;
    const box = h('div', { cls: 'inline-error', attrs: { role: 'alert' } });
    if (error.code) box.appendChild(h('span', { cls: 'err-code', text: '[' + error.code + ']' }));
    box.appendChild(document.createTextNode(errText(error)));
    if (error.tip) box.appendChild(h('div', { cls: 'inline-error-tip', text: error.tip }));
    return box;
  }

  function badge(text, kind) {
    return h('span', { cls: 'badge badge-' + (kind || 'muted'), text: text });
  }

  /* 触发型调用（打开链接 / 打开目录 / 停止预览）：
     主进程接口返回 Promise，若被拒绝不应产生未处理的 rejection，也不应影响界面。 */
  function fire(fn, arg) {
    try {
      const r = fn(arg);
      if (r && typeof r.then === 'function') r.then(null, function () { /* 忽略 */ });
    } catch (e) { /* 忽略 */ }
  }

  /* 分段控件：全部用 <button>，键盘可达 */
  function segmented(ariaLabel, options, current, onPick) {
    const group = h('div', { cls: 'seg', attrs: { role: 'group', 'aria-label': ariaLabel } });
    options.forEach(function (o) {
      const active = o.value === current;
      const btn = h('button', {
        cls: 'seg-btn' + (active ? ' active' : ''),
        text: o.label,
        attrs: { type: 'button', 'data-act': o.value, 'aria-pressed': active ? 'true' : 'false' },
        on: { click: function () { onPick(o.value); } }
      });
      group.appendChild(btn);
    });
    return group;
  }

  /* 只更新某条记录的 segmented / 打码预览，避免整页重绘导致焦点丢失 */
  function updateSegUi(row, action) {
    if (!row) return;
    Array.prototype.forEach.call(row.querySelectorAll('.seg-btn'), function (btn) {
      const on = btn.getAttribute('data-act') === action;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const maskPreview = row.querySelector('.mask-preview');
    if (maskPreview) maskPreview.classList.toggle('hidden', action !== 'mask');
    row.classList.toggle('kept', action === 'keep');
    renderSensStats();
  }

  /* 把主进程给的 snippet 按 ⟪ ⟫ 切分，用 span 高亮命中处（不使用 innerHTML） */
  function snippetFragment(raw) {
    const text = String(raw === undefined || raw === null ? '' : raw);
    const frag = document.createDocumentFragment();
    const re = /⟪([^⟫]*)⟫/g;
    let last = 0;
    let m;
    let matched = false;
    while ((m = re.exec(text)) !== null) {
      matched = true;
      if (m.index > last) frag.appendChild(document.createTextNode(stripMarks(text.slice(last, m.index))));
      frag.appendChild(h('span', { cls: 'hit', text: m[1] }));
      last = m.index + m[0].length;
    }
    const tail = stripMarks(text.slice(last));
    if (tail) frag.appendChild(document.createTextNode(tail));
    if (!matched && !frag.childNodes.length) frag.appendChild(document.createTextNode(text));
    return frag;
  }
  function stripMarks(s) { return String(s).replace(/[⟪⟫]/g, ''); }

  /* ==========================================================================
   * 2. 常量
   * ========================================================================*/
  const STEPS = [
    { n: 1, title: '开始', desc: '生成或导入设计稿' },
    { n: 2, title: '敏感信息', desc: '逐项选择处理' },
    { n: 3, title: '生成目录', desc: '脱敏并输出' },
    { n: 4, title: '上线 Pages', desc: '推送到 GitHub' },
    { n: 5, title: '完成', desc: '获取访问链接' }
  ];

  const TEXT_ACTIONS = [
    { value: 'mask', label: '打码' },
    { value: 'delete', label: '删除' },
    { value: 'hideblock', label: '隐藏整块' },
    { value: 'keep', label: '保留' }
  ];
  const IMAGE_ACTIONS = [
    { value: 'mask', label: '模糊打码' },
    { value: 'delete', label: '删除' },
    { value: 'keep', label: '保留' }
  ];
  const ACTION_LABEL = { mask: '打码', delete: '删除', hideblock: '隐藏整块', keep: '保留' };
  const SEVERITY_LABEL = { high: '高危', medium: '中危', low: '低危' };
  const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
  const KIND_LABEL = { text: '文本', attr: '属性', comment: '注释', rawtext: '原始文本' };
  const LOG_LEVEL_LABEL = { info: '信息', ok: '成功', warn: '警告', error: '错误', cmd: '命令' };
  const IMG_TAB = '__images__';
  const MAX_LOG_LINES = 500;

  const FOOTER_HINT = {
    1: '可以让 AI 从一句话生成网页，也可以直接导入已有的设计稿目录；右侧会自动装好所需插件',
    2: '逐项确认处理方式，选择结果会直接决定线上页面里留下什么',
    3: '先生成上线目录并本地预览，确认无误再推送',
    4: '上线会创建/推送 GitHub 仓库并开启 Pages，过程中可查看实时日志',
    5: '站点已上线，点击大链接即可访问'
  };

  /* ==========================================================================
   * 3. 集中状态
   * ========================================================================*/
  const state = {
    step: 1,
    maxStep: 1,

    root: null,
    scan: null,
    scanning: false,

    /* 第 1 步的两种开始方式：AI 生成 / 导入已有设计稿 */
    mode: 'import',
    gen: {
      brief: '',
      style: 'newspaper',
      animations: 'level1',
      review: false,
      sourceDir: null,
      provider: 'mock',
      model: '',
      busy: false,
      progress: null,
      result: null,
      error: null
    },
    genMeta: null,
    genMetaLoading: false,

    decisions: {},        // Finding.id -> 'mask' | 'delete' | 'hideblock' | 'keep'
    imageDecisions: {},   // ImageFinding.id -> 'mask' | 'delete' | 'keep'

    exclude: [],          // 勾选“不上传”的大文件 rel
    options: { stripExif: true, addNotice: false, siteTitle: '' },

    building: false,
    buildResult: null,

    tools: null,
    toolsBusy: false,
    toolsSetupDone: false,

    deployForm: {
      repoName: '',
      repoNameTouched: false,
      description: '个人作品展示网站',
      siteType: 'project',
      visibility: 'public',
      reuse: false,
      commitMessage: 'chore: 上线个人设计网站'
    },
    tokenOpen: false,
    authPending: false,
    deploying: false,
    deployResult: null,
    repoExists: false,

    progress: null,
    logs: [],

    keywords: [],        // 自定义关键词（前端过滤 + 随 options 提交）
    filter: 'all',
    expanded: {},        // finding.id -> true

    preview: null,
    previewBusy: false,

    err: { scan: null, build: null, deploy: null, login: null, preview: null, tools: null },

    offs: [],
    ui: { stepbar: null, stepBtns: [], back: null, next: null, hint: null, body: null, chip: null }
  };

  let authPoller = null;

  /* ==========================================================================
   * 4. 右侧「环境与插件」面板
   * ========================================================================*/
  function toolRow(label, info, opt) {
    opt = opt || {};
    const ok = !!(info && info.ok);
    const installing = !!(opt.installing || (info && info.installing));
    const row = h('div', { cls: 'tool-row' + (installing ? ' installing' : '') });
    row.appendChild(h('span', { cls: 'tool-dot ' + (installing ? 'busy' : (ok ? 'ok' : 'bad')) }));

    const main = h('div', { cls: 'tool-main' });
    main.appendChild(h('div', { cls: 'tool-name', text: label }));
    let sub;
    if (installing) sub = '正在安装…';
    else if (info && info.version) sub = String(info.version);
    else if (ok) sub = '已就绪';
    else sub = opt.missingText || '未检测到';
    main.appendChild(h('div', { cls: 'tool-sub', text: sub }));
    if (opt.note) main.appendChild(h('div', { cls: 'tool-note', text: opt.note }));
    if (!installing && opt.error) main.appendChild(h('div', { cls: 'tool-note', text: '错误：' + opt.error }));
    row.appendChild(main);

    if (installing) row.appendChild(spinner('tiny'));
    else row.appendChild(h('span', { cls: 'tool-state ' + (ok ? 'ok' : 'bad'), text: ok ? '✓' : '×' }));
    return row;
  }

  function authRow(auth) {
    const ok = !!(auth && auth.loggedIn);
    const row = h('div', { cls: 'tool-row' });
    row.appendChild(h('span', { cls: 'tool-dot ' + (ok ? 'ok' : 'bad') }));
    const main = h('div', { cls: 'tool-main' });
    main.appendChild(h('div', { cls: 'tool-name', text: 'GitHub 登录状态' }));
    main.appendChild(h('div', { cls: 'tool-sub', text: ok ? ('@' + (auth.user || '已登录')) : '未登录' }));
    const bits = [];
    if (ok && auth.host) bits.push(auth.host);
    if (ok && auth.protocol) bits.push(auth.protocol);
    if (ok && auth.scopes && auth.scopes.length) bits.push('scopes: ' + auth.scopes.join(','));
    if (bits.length) main.appendChild(h('div', { cls: 'tool-note', text: bits.join(' · ') }));
    row.appendChild(main);
    row.appendChild(h('span', { cls: 'tool-state ' + (ok ? 'ok' : 'bad'), text: ok ? '✓' : '×' }));
    return row;
  }

  function netRow(net) {
    const ok = !!(net && net.ok);
    const row = h('div', { cls: 'tool-row' });
    row.appendChild(h('span', { cls: 'tool-dot ' + (ok ? 'ok' : 'bad') }));
    const main = h('div', { cls: 'tool-main' });
    main.appendChild(h('div', { cls: 'tool-name', text: '网络' }));
    main.appendChild(h('div', { cls: 'tool-sub', text: ok ? (net.checkedAt ? fmtTime(net.checkedAt) + ' 检测正常' : '正常') : '连接 GitHub 失败' }));
    row.appendChild(main);
    row.appendChild(h('span', { cls: 'tool-state ' + (ok ? 'ok' : 'bad'), text: ok ? '✓' : '×' }));
    return row;
  }

  function renderToolsPanel() {
    const host = document.getElementById('toolsList');
    if (!host) return;
    clear(host);

    if (state.toolsBusy && !state.tools) {
      host.appendChild(h('div', { cls: 'tools-loading' }, [spinner('dark'), h('span', { text: '正在检测本机环境…' })]));
      return;
    }
    const t = state.tools;
    if (!t) {
      host.appendChild(h('div', { cls: 'tools-loading' }, [
        h('span', { text: state.err.tools ? ('检测失败：' + errText(state.err.tools)) : '尚未获取到环境状态' })
      ]));
      return;
    }

    host.appendChild(toolRow('Node.js', t.node, {}));
    host.appendChild(toolRow('npm', t.npm, {}));
    host.appendChild(toolRow('Git', t.git, { note: t.git && t.git.path ? t.git.path : null }));
    host.appendChild(toolRow('GitHub CLI', t.gh, {
      installing: t.gh && t.gh.installing,
      note: t.gh ? (t.gh.source === 'bundled' ? '内置版本' : (t.gh.source === 'system' ? '系统安装' : null)) : null
    }));
    host.appendChild(authRow(t.auth));
    host.appendChild(toolRow('图片打码插件 sharp', t.sharp, {
      installing: t.sharp && t.sharp.installing,
      error: t.sharp && t.sharp.error ? String(t.sharp.error) : null
    }));
    host.appendChild(netRow(t.net));

    const hint = document.getElementById('toolsHint');
    if (hint) {
      let text = '首次使用会自动安装缺失的插件（含图片打码插件 sharp），无需手动操作。';
      if (t.sharp && t.sharp.installing) text = '正在安装图片打码插件 sharp，请稍候…';
      else if (t.gh && t.gh.installing) text = '正在准备 GitHub CLI，请稍候…';
      else if (!t.gh || !t.gh.ok || !t.sharp || !t.sharp.ok) text = '仍有工具缺失，可点「重新检测」再次尝试安装。';
      hint.textContent = text;
    }
  }

  function toolsNeedSetup(t) {
    if (!t) return false;
    return !(t.node && t.node.ok) || !(t.npm && t.npm.ok) || !(t.git && t.git.ok) ||
           !(t.gh && t.gh.ok) || !(t.sharp && t.sharp.ok);
  }

  /* 进入第 1 步立即执行：status → 缺失则 setup（用户无感知地自动装好插件） */
  async function ensureTools(manual) {
    if (state.toolsBusy) return;
    state.toolsBusy = true;
    state.err.tools = null;
    renderToolsPanel();

    let res = null;
    try { res = await dd.tools.status(); } catch (e) { res = null; }
    state.toolsBusy = false;

    if (res && res.ok && res.tools) state.tools = res.tools;
    else if (res && res.error) { state.err.tools = res.error; if (manual) toast('环境检测失败：' + errText(res.error), 'danger'); }
    renderToolsPanel();

    if (!toolsNeedSetup(state.tools)) return;
    if (state.toolsSetupDone && !manual) { renderToolsPanel(); return; }

    state.toolsSetupDone = true;
    let sres = null;
    try { sres = await dd.tools.setup(); } catch (e) { sres = null; }
    if (sres && sres.ok && sres.tools) state.tools = sres.tools;
    else if (sres && sres.error) state.err.tools = sres.error;
    renderToolsPanel();
    if (state.step === 4) renderStepBody();
  }

  /* ==========================================================================
   * 5. 外壳：步骤条 / 底栏 / 站点标签
   * ========================================================================*/
  function buildShell() {
    state.ui.body = document.getElementById('stepBody');
    state.ui.hint = document.getElementById('footerHint');
    state.ui.back = document.getElementById('btnBack');
    state.ui.next = document.getElementById('btnNext');
    state.ui.chip = document.getElementById('siteChip');

    const bar = document.getElementById('stepbar');
    state.ui.stepbar = bar;
    clear(bar);
    state.ui.stepBtns = [];
    STEPS.forEach(function (s, i) {
      if (i > 0) bar.appendChild(h('span', { cls: 'step-sep', attrs: { 'data-sep': String(i) } }));
      const btn = h('button', {
        cls: 'step',
        attrs: { type: 'button', 'data-step': String(s.n) },
        on: { click: function () { goStep(s.n); } }
      });
      btn.appendChild(h('span', { cls: 'step-num', text: String(s.n) }));
      const txt = h('span', { cls: 'step-text' });
      txt.appendChild(h('span', { cls: 'step-title', text: s.title }));
      txt.appendChild(document.createTextNode(' '));
      txt.appendChild(h('span', { cls: 'step-desc', text: s.desc }));
      btn.appendChild(txt);
      bar.appendChild(btn);
      state.ui.stepBtns.push(btn);
    });

    state.ui.back.addEventListener('click', function () { if (state.step > 1) goStep(state.step - 1); });
    state.ui.next.addEventListener('click', nextStep);

    const recheck = document.getElementById('btnRecheck');
    if (recheck) recheck.addEventListener('click', function () { ensureTools(true); });

    const ver = document.getElementById('brandVersion');
    if (ver) {
      const v = dd.app && dd.app.version ? String(dd.app.version) : '';
      const ws = dd.app && dd.app.paths && dd.app.paths.workspaces ? dd.app.paths.workspaces : '';
      ver.textContent = (v ? 'v' + v : '版本未知') + (ws ? ' · 工作区 ' + ws : '');
      ver.title = ws || '';
    }
  }

  function renderStepBar() {
    state.ui.stepBtns.forEach(function (btn, i) {
      const n = i + 1;
      btn.classList.toggle('active', n === state.step);
      btn.classList.toggle('done', n < state.step);
      btn.classList.toggle('locked', n > state.maxStep);
      btn.disabled = n > state.maxStep;
      btn.setAttribute('aria-current', n === state.step ? 'step' : 'false');
    });
    const seps = state.ui.stepbar ? state.ui.stepbar.querySelectorAll('.step-sep') : [];
    Array.prototype.forEach.call(seps, function (sp, i) {
      sp.classList.toggle('done', (i + 1) < state.step);
    });
  }

  function canAdvance() {
    if (state.step === 1) return !!state.scan;
    if (state.step === 2) return !!state.scan;
    if (state.step === 3) return !!state.buildResult;
    if (state.step === 4) return !!state.deployResult;
    return false;
  }

  function renderFooter() {
    if (state.ui.hint) state.ui.hint.textContent = FOOTER_HINT[state.step] || '';
    if (state.ui.back) {
      state.ui.back.disabled = state.step <= 1;
      state.ui.back.classList.toggle('hidden', state.step >= 5);
    }
    if (state.ui.next) {
      state.ui.next.classList.toggle('hidden', state.step >= 5);
      state.ui.next.disabled = !canAdvance();
      state.ui.next.textContent = state.step === 4 ? '查看结果' : '下一步';
    }
  }

  function renderSiteChip() {
    const chip = state.ui.chip;
    if (!chip) return;
    const s = state.scan;
    if (s) {
      chip.textContent = s.name || basename(state.root || '') || '已导入站点';
      chip.title = state.root || '';
      chip.classList.add('chip-strong');
    } else {
      chip.textContent = '未导入站点';
      chip.title = '当前导入的站点';
      chip.classList.remove('chip-strong');
    }
  }

  function goStep(n) {
    if (n > state.maxStep) { toast('请按顺序完成前面的步骤', 'warn'); return; }
    state.step = n;
    if (n === 1 && !state.tools && !state.toolsBusy) ensureTools(false);
    render();
    const body = state.ui.body;
    if (body) body.scrollTop = 0;
  }

  function nextStep() {
    if (!canAdvance()) {
      toast(state.step === 1 ? '请先导入设计稿' :
            state.step === 2 ? '请先导入设计稿' :
            state.step === 3 ? '请先生成上线目录' : '请先完成上线', 'warn');
      return;
    }
    const target = Math.min(5, state.step + 1);
    if (target > state.maxStep) state.maxStep = target;
    state.step = target;
    render();
    const body = state.ui.body;
    if (body) body.scrollTop = 0;
  }

  /* ==========================================================================
   * 6. 总渲染入口（只重绘当前步骤的容器）
   * ========================================================================*/
  function render() {
    renderStepBar();
    renderFooter();
    renderSiteChip();
    renderStepBody();
  }

  function renderStepBody() {
    const host = state.ui.body;
    if (!host) return;
    host.className = 'content step-' + state.step;
    clear(host);
    if (state.step === 1) renderStep1(host);
    else if (state.step === 2) renderStep2(host);
    else if (state.step === 3) renderStep3(host);
    else if (state.step === 4) renderStep4(host);
    else renderStep5(host);
  }

  /* ==========================================================================
   * 7. 步骤 1：导入设计稿
   * ========================================================================*/
  function renderStep1(host) {
    host.appendChild(renderModeTabs());

    if (state.mode === 'generate') {
      host.appendChild(renderGenForm());
      return;
    }

    host.appendChild(renderDropzone());
    if (state.err.scan) host.appendChild(inlineErrorBox(state.err.scan));
    if (state.scan) host.appendChild(renderSiteOverview(state.scan));
  }

  /* ---- 开始方式切换：AI 生成 / 已有设计稿 ---- */
  function renderModeTabs() {
    const wrap = h('div', { cls: 'mode-tabs', attrs: { role: 'tablist', 'aria-label': '选择开始方式' } });
    const items = [
      { value: 'generate', title: 'AI 生成网页', sub: '一句话描述，自动做出页面' },
      { value: 'import', title: '已有设计稿', sub: '导入现成的 index.html 目录' }
    ];
    items.forEach(function (it) {
      const active = state.mode === it.value;
      const btn = h('button', {
        cls: 'mode-tab' + (active ? ' active' : ''),
        attrs: { type: 'button', role: 'tab', 'aria-selected': active ? 'true' : 'false' },
        on: {
          click: function () {
            if (state.mode === it.value) return;
            state.mode = it.value;
            state.err.scan = null;
            if (it.value === 'generate') loadGenMeta();
            render();
          }
        }
      });
      btn.appendChild(h('span', { cls: 'mode-tab-title', text: it.title }));
      btn.appendChild(h('span', { cls: 'mode-tab-sub', text: it.sub }));
      wrap.appendChild(btn);
    });
    return wrap;
  }

  async function loadGenMeta() {
    if (state.genMeta || state.genMetaLoading) return;
    state.genMetaLoading = true;
    let res = null;
    try { res = await dd.llmProviders(); } catch (e) { res = null; }
    state.genMetaLoading = false;
    if (res && res.ok) {
      state.genMeta = { providers: res.providers || [], styles: res.styles || {} };
      render();
    } else {
      state.genMeta = { providers: [], styles: {} };
    }
  }

  /* ---- 生成表单 ---- */
  function renderGenForm() {
    const card = h('div', { cls: 'card card-accent' });
    card.appendChild(h('div', { cls: 'card-title', text: '想做怎样的网页？' }));
    card.appendChild(
      h('div', {
        cls: 'card-sub',
        text: '用一句话说清用途、内容和风格。生成后会立刻扫描敏感信息，再脱敏、预览、上线。'
      })
    );

    // 需求描述
    const ta = h('textarea', {
      cls: 'gen-brief',
      attrs: {
        id: 'genBrief',
        rows: '5',
        placeholder: '例如：个人作品集单页，我是新媒体运营，要有自我介绍、作品列表（图片可点开放大）和联系方式，风格偏报纸印刷、章节叙事。',
        'aria-label': '网页需求描述'
      },
      on: {
        input: function (ev) { state.gen.brief = ev.target.value; }
      }
    });
    ta.value = state.gen.brief || '';
    card.appendChild(ta);

    // 示例模板
    const examples = [
      '个人作品集单页，含自我介绍、作品列表、联系方式，风格简洁现代',
      '摄影作品展示页，图片可以分类筛选并点击放大，深色背景',
      '一页式简历网站，报纸排版风格，突出数据和经历'
    ];
    const chips = h('div', { cls: 'gen-chips' });
    examples.forEach(function (txt) {
      chips.appendChild(
        h('button', {
          cls: 'chip',
          attrs: { type: 'button' },
          text: txt,
          on: {
            click: function () {
              state.gen.brief = txt;
              const box = document.getElementById('genBrief');
              if (box) box.value = txt;
            }
          }
        })
      );
    });
    card.appendChild(chips);

    /* 选项行 */
    const rows = h('div', { cls: 'gen-rows' });

    rows.appendChild(genField('视觉风格', buildStyleSelect()));
    rows.appendChild(genField('动效', buildAnimSelect()));
    rows.appendChild(genField('模型', buildProviderSelect()));
    rows.appendChild(genField('素材目录（可选）', buildSourcePicker()));

    const reviewRow = h('label', { cls: 'gen-check' });
    const cb = h('input', { attrs: { type: 'checkbox', id: 'genReview' }, on: { change: function (ev) { state.gen.review = !!ev.target.checked; } } });
    cb.checked = !!state.gen.review;
    reviewRow.appendChild(cb);
    reviewRow.appendChild(h('span', { text: '生成后跑一次设计评审（六维度打分，多几次模型调用）' }));
    rows.appendChild(reviewRow);

    card.appendChild(rows);

    // 生成按钮
    const actions = h('div', { cls: 'gen-actions' });
    const runBtn = h('button', {
      cls: 'btn btn-primary',
      attrs: { type: 'button', id: 'genRun' },
      text: state.gen.busy ? '正在生成…' : '开始生成网页',
      on: { click: function () { startGenerate(); } }
    });
    if (state.gen.busy) runBtn.setAttribute('disabled', 'disabled');
    actions.appendChild(runBtn);
    if (state.gen.busy) actions.appendChild(spinner('dark'));
    card.appendChild(actions);

    if (state.gen.error) card.appendChild(inlineErrorBox(state.gen.error));

    // 进度
    if (state.gen.busy) {
      const p = state.gen.progress || { percent: 0, label: '准备中…' };
      const wrap = h('div', { cls: 'progress-wrap', attrs: { style: 'margin-top:12px' } });
      const head = h('div', { cls: 'progress-head' });
      head.appendChild(h('div', { cls: 'progress-label', attrs: { id: 'genProgressLabel' }, text: p.label || '准备中…' }));
      head.appendChild(h('div', { cls: 'small dim', attrs: { id: 'genProgressHint' }, text: '规整素材 → 规划结构 → 分块生成 → 组装' }));
      wrap.appendChild(head);
      const track = h('div', { cls: 'progress-track' });
      const bar = h('div', { cls: 'progress-bar', attrs: { id: 'genProgressBar' } });
      bar.style.width = (p.percent == null ? 4 : Math.max(4, p.percent)) + '%';
      track.appendChild(bar);
      wrap.appendChild(track);
      card.appendChild(wrap);
    }

    // 结果
    if (state.gen.result) card.appendChild(renderGenResult(state.gen.result));

    return card;
  }

  function genField(labelText, control) {
    const row = h('div', { cls: 'gen-row' });
    row.appendChild(h('div', { cls: 'gen-label', text: labelText }));
    row.appendChild(control);
    return row;
  }

  function buildStyleSelect() {
    const select = h('select', {
      cls: 'gen-select',
      attrs: { 'aria-label': '视觉风格' },
      on: { change: function (ev) { state.gen.style = ev.target.value; } }
    });
    const styles = (state.genMeta && state.genMeta.styles) || {};
    const keys = Object.keys(styles);
    const list = keys.length ? keys : ['newspaper', 'plain', 'pastel', 'dark'];
    list.forEach(function (k) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = (styles[k] && styles[k].label) || k;
      if (state.gen.style === k) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }

  function buildAnimSelect() {
    const select = h('select', {
      cls: 'gen-select',
      attrs: { 'aria-label': '动效' },
      on: { change: function (ev) { state.gen.animations = ev.target.value; } }
    });
    [['level1', '优雅档（推荐）'], ['none', '不要动效']].forEach(function (pair) {
      const opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      if (state.gen.animations === pair[0]) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }

  function buildProviderSelect() {
    const select = h('select', {
      cls: 'gen-select',
      attrs: { 'aria-label': '模型' },
      on: {
        change: function (ev) {
          state.gen.provider = ev.target.value;
          const p = ((state.genMeta && state.genMeta.providers) || []).filter(function (x) { return x.id === ev.target.value; })[0];
          state.gen.model = (p && p.model) || '';
        }
      }
    });
    const providers = (state.genMeta && state.genMeta.providers) || [];
    if (!providers.length) {
      const opt = document.createElement('option');
      opt.value = 'mock';
      opt.textContent = '本地模拟（无需 key）';
      select.appendChild(opt);
      return select;
    }
    providers.forEach(function (p) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label + (p.ready ? '' : '（缺 key）');
      opt.disabled = !p.ready && p.id !== 'mock';
      if (state.gen.provider === p.id) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }

  function buildSourcePicker() {
    const wrap = h('div', { cls: 'gen-picker' });
    const label = h('div', { cls: 'small mono dim', text: state.gen.sourceDir || '未选择（将生成纯文字版式）' });
    const btn = h('button', {
      cls: 'btn btn-sm',
      attrs: { type: 'button' },
      text: state.gen.sourceDir ? '换目录' : '选择素材目录',
      on: {
        click: async function () {
          let p = null;
          try { p = await dd.dialog.pickFolder(); } catch (e) { p = null; }
          if (!p) return;
          state.gen.sourceDir = p;
          render();
        }
      }
    });
    wrap.appendChild(btn);
    wrap.appendChild(label);
    if (state.gen.sourceDir) {
      wrap.appendChild(
        h('button', {
          cls: 'btn btn-sm',
          attrs: { type: 'button' },
          text: '清除',
          on: { click: function () { state.gen.sourceDir = null; render(); } }
        })
      );
    }
    return wrap;
  }

  function renderGenResult(res) {
    const box = h('div', { cls: 'gen-result' });
    box.appendChild(h('div', { cls: 'gen-result-title', text: '✔ 网页已生成' }));
    box.appendChild(h('div', { cls: 'small mono', text: res.outDir || '' }));

    const meta = h('div', { cls: 'gen-result-meta' });
    meta.appendChild(h('span', { cls: 'tag', text: '区块 ' + (res.blocks || []).length }));
    meta.appendChild(h('span', { cls: 'tag', text: '素材 ' + ((res.assets && res.assets.count) || 0) }));
    meta.appendChild(h('span', { cls: 'tag', text: '模型调用 ' + ((res.usage && res.usage.calls) || 0) + ' 次' }));
    if (res.usage && res.usage.costUsd) meta.appendChild(h('span', { cls: 'tag', text: '约 $' + res.usage.costUsd.toFixed(4) }));
    box.appendChild(meta);

    if (res.review && res.review.scores) {
      const scores = h('div', { cls: 'gen-scores' });
      Object.keys(res.review.scores).forEach(function (k) {
        scores.appendChild(h('span', { cls: 'score-pill', text: k + ' ' + res.review.scores[k] }));
      });
      box.appendChild(scores);
      (res.review.issues || []).slice(0, 3).forEach(function (it) {
        box.appendChild(h('div', { cls: 'small dim', text: '· [' + it.dimension + '] ' + it.problem + ' → ' + it.fix }));
      });
    }

    const actions = h('div', { cls: 'gen-actions' });
    actions.appendChild(
      h('button', {
        cls: 'btn btn-primary',
        attrs: { type: 'button' },
        text: '继续：扫描敏感信息',
        on: {
          click: async function () {
            const dir = res.outDir;
            if (!dir) return;
            await startScan(dir);
            if (state.scan) {
              state.step = 2;
              state.maxStep = Math.max(state.maxStep, 2);
              render();
            }
          }
        }
      })
    );
    actions.appendChild(
      h('button', {
        cls: 'btn',
        attrs: { type: 'button' },
        text: '打开生成目录',
        on: { click: function () { if (res.outDir) dd.shell.openPath(res.outDir); } }
      })
    );
    box.appendChild(actions);
    return box;
  }

  async function startGenerate() {
    if (state.gen.busy) return;
    const brief = String(state.gen.brief || '').trim();
    if (!brief) {
      toast('先描述一下你想做的网页', 'warn');
      return;
    }
    state.gen.busy = true;
    state.gen.error = null;
    state.gen.progress = null;
    state.gen.result = null;
    state.logs = [];
    state.progress = null;
    render();

    let res = null;
    try {
      res = await dd.generate({
        brief: brief,
        sourceDir: state.gen.sourceDir || null,
        style: state.gen.style,
        animations: state.gen.animations,
        review: !!state.gen.review,
        provider: state.gen.provider || undefined,
        model: state.gen.model || undefined
      });
    } catch (e) {
      res = { ok: false, error: { code: 'E_UNKNOWN', message: errText(e) } };
    }
    state.gen.busy = false;
    state.gen.progress = null;

    if (res && res.ok) {
      state.gen.result = res;
      state.gen.error = null;
      toast('网页生成完成', 'ok');
    } else {
      state.gen.error = err(res);
      toast('生成失败：' + state.gen.error.message, 'warn');
    }
    render();
  }

  function renderDropzone() {
    const scanning = state.scanning;
    const zone = h('div', {
      cls: 'dropzone' + (dragDepth > 0 ? ' hot' : '') + (scanning ? ' scanning' : ''),
      attrs: { id: 'dropzone', tabindex: '0', role: 'button', 'aria-label': '拖入设计稿文件夹，或按回车选择文件夹' },
      on: {
        click: function (ev) {
          if (scanning) return;
          if (ev.target && ev.target.closest && ev.target.closest('button')) return;
          chooseFolder();
        },
        keydown: function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); chooseFolder(); }
        }
      }
    });

    zone.appendChild(h('div', { cls: 'dropzone-icon', text: scanning ? '⏳' : '📁' }));

    if (scanning) {
      zone.appendChild(h('div', { cls: 'dropzone-title', text: '正在扫描敏感信息…' }));
      zone.appendChild(h('div', { cls: 'dropzone-sub', text: '正在统计文件、检查图片 EXIF 与文本中的手机号 / 邮箱 / 身份证等' }));
      zone.appendChild(h('div', { cls: 'dropzone-scan' }, [spinner('dark'), h('span', { text: '请稍候，大站点可能需要十几秒' })]));
      return zone;
    }

    zone.appendChild(h('div', { cls: 'dropzone-title', text: '把设计稿文件夹拖到这里' }));
    zone.appendChild(h('div', { cls: 'dropzone-sub', text: '支持拖入整个站点文件夹，或直接拖入 index.html；不会修改原始文件' }));

    const actions = h('div', { cls: 'dropzone-actions' });
    const b1 = h('button', { cls: 'btn btn-primary', text: '选择文件夹', attrs: { type: 'button' }, on: { click: function (ev) { ev.stopPropagation(); chooseFolder(); } } });
    const b2 = h('button', { cls: 'btn', text: '选择 index.html', attrs: { type: 'button' }, on: { click: function (ev) { ev.stopPropagation(); chooseIndexHtml(); } } });
    actions.appendChild(b1);
    actions.appendChild(b2);
    zone.appendChild(actions);
    return zone;
  }

  async function chooseFolder() {
    if (state.scanning) return;
    let p = null;
    try { p = await dd.dialog.pickFolder(); } catch (e) { p = null; }
    if (!p) return;
    await startScan(p);
  }

  async function chooseIndexHtml() {
    if (state.scanning) return;
    let files = null;
    try { files = await dd.dialog.pickFiles(); } catch (e) { files = null; }
    if (!files || !files.length) return;
    const html = files.filter(isHtmlPath)[0];
    let root;
    if (html) root = dirname(html);
    else if (/[\\/]/.test(files[0])) root = dirname(files[0]);
    else root = files[0];
    await startScan(root);
  }

  async function startScan(root) {
    state.scanning = true;
    state.err.scan = null;
    render();

    let res = null;
    try { res = await dd.scan({ root: root }); } catch (e) { res = null; }
    state.scanning = false;

    if (res && res.ok) {
      state.root = res.root || root;
      state.scan = res;
      mergeDecisions(res);
      state.filter = 'all';
      state.expanded = {};
      state.exclude = [];
      state.buildResult = null;
      state.preview = null;
      state.deployResult = null;
      state.logs = [];
      state.progress = null;
      state.maxStep = Math.max(state.maxStep, 2);
      const total = (res.findings ? res.findings.length : 0) + (res.images ? res.images.length : 0);
      toast('扫描完成：发现 ' + total + ' 项需要确认的内容', 'ok');
    } else {
      state.err.scan = res ? err(res) : { code: 'E_UNKNOWN', message: '扫描失败，未返回详细信息' };
      state.scan = null;
    }
    render();
  }

  function mergeDecisions(scan) {
    const prevD = state.decisions;
    const prevI = state.imageDecisions;
    const d = {};
    const i = {};
    (scan.findings || []).forEach(function (f) {
      const allowed = ['mask', 'delete', 'hideblock', 'keep'];
      if (prevD[f.id] && allowed.indexOf(prevD[f.id]) !== -1) d[f.id] = prevD[f.id];
      else d[f.id] = (f.defaultAction === 'keep') ? 'keep' : 'mask';
    });
    (scan.images || []).forEach(function (im) {
      if (prevI[im.id] === 'mask' || prevI[im.id] === 'delete' || prevI[im.id] === 'keep') i[im.id] = prevI[im.id];
      else i[im.id] = (im.defaultAction === 'keep') ? 'keep' : 'mask';
    });
    state.decisions = d;
    state.imageDecisions = i;
  }

  function renderSiteOverview(scan) {
    const card = h('div', { cls: 'card card-accent' });
    const head = h('div', { cls: 'card-head' });
    const titleBox = h('div');
    titleBox.appendChild(h('div', { cls: 'card-title', text: scan.name || basename(scan.root || '') || '站点' }));
    titleBox.appendChild(h('div', { cls: 'card-sub mono', text: scan.root || state.root || '' }));
    head.appendChild(titleBox);
    const actions = h('div', { cls: 'card-actions' });
    actions.appendChild(h('button', {
      cls: 'btn btn-sm', text: '重新选择目录', attrs: { type: 'button' },
      on: { click: function () { chooseFolder(); } }
    }));
    head.appendChild(actions);
    card.appendChild(head);

    const stats = scan.stats || {};
    const grid = h('div', { cls: 'stat-grid' });
    grid.appendChild(statTile('入口文件', scan.indexHtml || '未找到', scan.indexHtml ? null : 'warn', scan.indexHtml ? 'index.html' : '上线后可能无法正常访问'));
    grid.appendChild(statTile('文件总数', String(stats.files || 0), null, (stats.textFiles ? stats.textFiles + ' 个文本文件' : null)));
    grid.appendChild(statTile('总体积', fmtBytes(stats.bytes || 0), null, null));
    grid.appendChild(statTile('图片数量', String(stats.images || 0), null, null));
    card.appendChild(grid);

    if (!scan.indexHtml) {
      card.appendChild(h('div', { cls: 'notice notice-warn' }, [
        h('div', { cls: 'notice-title', text: '没有找到 index.html 入口' }),
        h('div', { text: '仍然可以继续，但 GitHub Pages 需要一个入口文件才能正常访问，建议先确认目录是否选对。' })
      ]));
    }

    const biggest = (stats.biggest || []).slice(0, 5);
    if (biggest.length) {
      card.appendChild(h('div', { cls: 'section-title' }, [h('span', { text: '最大的 5 个文件' })]));
      const maxBytes = biggest.reduce(function (a, b) { return Math.max(a, Number(b.bytes) || 0); }, 1);
      const table = h('table', { cls: 'table' });
      table.appendChild(h('thead', {}, h('tr', {}, [
        h('th', { text: '文件' }), h('th', { text: '占比' }), h('th', { text: '体积' })
      ])));
      const tbody = h('tbody');
      biggest.forEach(function (b) {
        const bytes = Number(b.bytes) || 0;
        const pct = Math.max(2, Math.round((bytes / maxBytes) * 100));
        const bar = h('div', { cls: 'bar' }, h('div', { cls: 'bar-fill', attrs: { style: 'width:' + pct + '%' } }));
        tbody.appendChild(h('tr', {}, [
          h('td', { cls: 'mono', text: b.rel || '' }),
          h('td', {}, h('div', { cls: 'bar-cell' }, bar)),
          h('td', { cls: 'num', text: fmtBytes(bytes) })
        ]));
      });
      table.appendChild(tbody);
      card.appendChild(h('div', { cls: 'table-wrap' }, table));
    }

    const largeFiles = scan.largeFiles || [];
    if (largeFiles.length) {
      const list = h('ul');
      largeFiles.forEach(function (lf) {
        list.appendChild(h('li', { text: (lf.rel || '') + '（' + fmtBytes(lf.bytes) + '）' }));
      });
      card.appendChild(h('div', { cls: 'notice notice-warn' }, [
        h('div', { cls: 'notice-title', text: '这些文件超过 50MB，GitHub 上传会变慢甚至被拒' }),
        h('div', { text: '可以在第 3 步勾选它们「不上传」，站点里对应的链接会被移除。' }),
        list
      ]));
    }

    const warnings = scan.warnings || [];
    if (warnings.length) {
      const list = h('ul');
      warnings.forEach(function (w) { list.appendChild(h('li', { text: String(w) })); });
      card.appendChild(h('div', { cls: 'notice notice-info' }, [
        h('div', { cls: 'notice-title', text: '扫描提示' }), list
      ]));
    }

    const total = (scan.findings ? scan.findings.length : 0) + (scan.images ? scan.images.length : 0);
    const actionsRow = h('div', { cls: 'card-head', attrs: { style: 'margin:12px 0 0' } });
    actionsRow.appendChild(h('div', { cls: 'small muted', text: '共 ' + total + ' 项需要确认，下一步逐项选择处理方式' }));
    const go = h('div', { cls: 'card-actions' });
    go.appendChild(h('button', {
      cls: 'btn btn-primary', text: '开始逐项确认 →', attrs: { type: 'button' },
      on: {
        click: function () {
          if (state.maxStep < 2) state.maxStep = 2;
          state.step = 2;
          render();
          if (state.ui.body) state.ui.body.scrollTop = 0;
        }
      }
    }));
    actionsRow.appendChild(go);
    card.appendChild(actionsRow);
    return card;
  }

  function statTile(label, value, tone, hint) {
    const box = h('div', { cls: 'stat' });
    box.appendChild(h('div', { cls: 'stat-label', text: label }));
    box.appendChild(h('div', { cls: 'stat-value' + (tone ? ' ' + tone : ''), text: value, attrs: { title: String(value) } }));
    if (hint) box.appendChild(h('div', { cls: 'stat-hint', text: hint }));
    return box;
  }

  /* ==========================================================================
   * 8. 步骤 2：敏感信息逐项选择
   * ========================================================================*/
  function categories(findings, images) {
    const out = [];
    findings.forEach(function (f) {
      const c = f.category || '其他';
      if (out.indexOf(c) === -1) out.push(c);
    });
    if (images.length) out.push(IMG_TAB);
    return out;
  }

  function isKeywordHit(text) {
    if (!state.keywords.length) return null;
    const hay = String(text === undefined || text === null ? '' : text).toLowerCase();
    for (let i = 0; i < state.keywords.length; i++) {
      const k = state.keywords[i].toLowerCase();
      if (k && hay.indexOf(k) !== -1) return state.keywords[i];
    }
    return null;
  }

  function findingHit(f) { return isKeywordHit(String(f.value || '') + ' ' + String(f.preview || '')); }
  function imageHit(im) {
    return isKeywordHit(String(im.rel || '') + ' ' + ((im.tags || []).join(' ')));
  }

  function filteredFindings() {
    const all = (state.scan && state.scan.findings) || [];
    let list = state.filter === 'all' ? all.slice() : all.filter(function (f) { return (f.category || '其他') === state.filter; });
    list.sort(function (a, b) {
      const ha = findingHit(a) ? 0 : 1;
      const hb = findingHit(b) ? 0 : 1;
      if (ha !== hb) return ha - hb;
      const sa = SEVERITY_RANK[a.severity] === undefined ? 3 : SEVERITY_RANK[a.severity];
      const sb = SEVERITY_RANK[b.severity] === undefined ? 3 : SEVERITY_RANK[b.severity];
      if (sa !== sb) return sa - sb;
      if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
      return String(a.value || '').localeCompare(String(b.value || ''));
    });
    return list;
  }

  function filteredImages() {
    const all = (state.scan && state.scan.images) || [];
    if (state.filter !== 'all' && state.filter !== IMG_TAB) return [];
    const list = all.slice();
    list.sort(function (a, b) {
      const ha = imageHit(a) ? 0 : 1;
      const hb = imageHit(b) ? 0 : 1;
      if (ha !== hb) return ha - hb;
      return String(a.rel || '').localeCompare(String(b.rel || ''));
    });
    return list;
  }

  function renderStep2(host) {
    const scan = state.scan;
    if (!scan) {
      host.appendChild(emptyState('还没有导入设计稿', '请回到第 1 步选择包含 index.html 的文件夹'));
      return;
    }

    /* 统计条 + 批量按钮 */
    const statsCard = h('div', { cls: 'card card-tight' });
    statsCard.appendChild(h('div', { cls: 'sens-stats', attrs: { id: 'sensStats' } }));
    statsCard.appendChild(h('div', { cls: 'divider' }));
    const batch = h('div', { cls: 'batch-actions' });
    batch.appendChild(h('button', {
      cls: 'btn btn-sm', text: '全部打码', attrs: { type: 'button', 'data-batch': 'mask' },
      on: { click: function () { applyBatch('mask'); } }
    }));
    batch.appendChild(h('button', {
      cls: 'btn btn-sm', text: '全部删除', attrs: { type: 'button', 'data-batch': 'delete' },
      on: { click: function () { applyBatch('delete'); } }
    }));
    batch.appendChild(h('button', {
      cls: 'btn btn-sm', text: '全部隐藏整块', attrs: { type: 'button', 'data-batch': 'hideblock' },
      on: { click: function () { applyBatch('hideblock'); } }
    }));
    batch.appendChild(h('button', {
      cls: 'btn btn-sm', text: '全部保留', attrs: { type: 'button', 'data-batch': 'keep' },
      on: { click: function () { applyBatch('keep'); } }
    }));
    statsCard.appendChild(batch);
    statsCard.appendChild(h('div', { cls: 'small dim', attrs: { style: 'margin-top:8px' }, text: '批量操作只作用于当前筛选（' + (state.filter === IMG_TAB ? '图片' : state.filter === 'all' ? '全部' : state.filter) + '）结果' }));
    host.appendChild(statsCard);

    /* 类别筛选 */
    const tabs = h('div', { cls: 'tabs', attrs: { style: 'margin:4px 0 14px' } });
    const cats = categories(scan.findings || [], scan.images || []);
    const allFindings = scan.findings || [];
    const mkTab = function (value, label, count) {
      const active = state.filter === value;
      const btn = h('button', {
        cls: 'tab' + (active ? ' active' : ''),
        attrs: { type: 'button', 'aria-pressed': active ? 'true' : 'false', 'data-filter': value },
        on: { click: function () { state.filter = value; renderStepBody(); } }
      });
      btn.appendChild(document.createTextNode(label));
      btn.appendChild(h('span', { cls: 'tab-count', text: String(count) }));
      return btn;
    };
    tabs.appendChild(mkTab('all', '全部', allFindings.length + (scan.images || []).length));
    cats.forEach(function (c) {
      if (c === IMG_TAB) tabs.appendChild(mkTab(IMG_TAB, '图片', (scan.images || []).length));
      else tabs.appendChild(mkTab(c, c, allFindings.filter(function (f) { return (f.category || '其他') === c; }).length));
    });
    host.appendChild(tabs);

    /* 文本条目 */
    const findings = filteredFindings();
    const images = filteredImages();

    if (!findings.length && !images.length) {
      host.appendChild(emptyState('当前筛选下没有条目', '换一个类别，或检查关键词筛选'));
    }

    if (findings.length) {
      host.appendChild(h('div', { cls: 'section-title' }, [
        h('span', { text: '文本类敏感信息' }),
        h('span', { cls: 'count', text: '（' + findings.length + ' 项）' })
      ]));
      const listBox = h('div', { attrs: { id: 'findingList' } });
      findings.forEach(function (f) { listBox.appendChild(findingRow(f)); });
      host.appendChild(listBox);
    }

    if (images.length) {
      host.appendChild(h('div', { cls: 'section-title' }, [
        h('span', { text: '图片' }),
        h('span', { cls: 'count', text: '（' + images.length + ' 项）' })
      ]));
      images.forEach(function (im) { host.appendChild(imageRow(im)); });
    }

    host.appendChild(renderKeywordCard());
    renderSensStats();
  }

  function renderSensStats() {
    const box = document.getElementById('sensStats');
    if (!box) return;
    clear(box);
    const scan = state.scan || { findings: [], images: [] };
    const findings = scan.findings || [];
    const images = scan.images || [];
    let high = 0, medium = 0;
    findings.forEach(function (f) {
      if (f.severity === 'high') high++;
      else if (f.severity === 'medium') medium++;
    });
    let masked = 0, deleted = 0, hidden = 0, kept = 0;
    findings.forEach(function (f) {
      const a = state.decisions[f.id];
      if (a === 'mask') masked++;
      else if (a === 'delete') deleted++;
      else if (a === 'hideblock') hidden++;
      else kept++;
    });
    images.forEach(function (im) {
      const a = state.imageDecisions[im.id];
      if (a === 'keep') kept++;
      else if (a === 'delete') deleted++;
      else masked++;
    });

    box.appendChild(sensStat(String(findings.length + images.length), '共 N 项敏感信息', 'plain'));
    box.appendChild(sensStat(String(high), '高危', 'high'));
    box.appendChild(sensStat(String(medium), '中危', 'medium'));
    box.appendChild(sensStat(String(masked), '将打码', 'plain'));
    box.appendChild(sensStat(String(deleted), '将删除', 'plain'));
    box.appendChild(sensStat(String(hidden), '将隐藏整块', 'plain'));
    box.appendChild(sensStat(String(kept), '仍保留', kept ? 'medium' : 'plain'));
  }

  function sensStat(num, label, tone) {
    const box = h('div', { cls: 'sens-stat' });
    box.appendChild(h('span', { cls: 'num ' + (tone || 'plain'), text: num }));
    box.appendChild(h('span', { cls: 'lbl', text: label }));
    return box;
  }

  function applyBatch(action) {
    if (state.filter === IMG_TAB) {
      if (action === 'hideblock') { toast('图片项只支持「模糊打码 / 删除 / 保留」', 'warn'); return; }
      filteredImages().forEach(function (im) { state.imageDecisions[im.id] = action; });
      toast('已对 ' + filteredImages().length + ' 个图片项设置「' + ACTION_LABEL[action] + '」', 'ok');
    } else {
      filteredFindings().forEach(function (f) { state.decisions[f.id] = action; });
      toast('已对 ' + filteredFindings().length + ' 项设置「' + ACTION_LABEL[action] + '」', 'ok');
    }
    renderStepBody();
  }

  function filesText(files) {
    const list = files || [];
    if (!list.length) return '';
    if (list.length <= 3) return list.join('、');
    return list.slice(0, 3).join('、') + ' 等 ' + list.length + ' 个文件';
  }

  function findingRow(f) {
    const action = state.decisions[f.id] || 'mask';
    const hitKw = findingHit(f);
    const row = h('div', {
      cls: 'row' + (hitKw ? ' custom-hit' : '') + (action === 'keep' ? ' kept' : ''),
      attrs: { 'data-id': f.id, 'data-kind': 'finding' }
    });

    const main = h('div', { cls: 'row-main' });
    const title = h('div', { cls: 'row-title' });
    title.appendChild(h('span', { cls: 'value', text: f.preview || f.value || '(空)' }));
    const maskPrev = h('span', {
      cls: 'mask-preview' + (action === 'mask' ? '' : ' hidden'),
      text: f.maskPreview ? ('→ ' + f.maskPreview) : '→ 将被打码'
    });
    title.appendChild(maskPrev);
    if (hitKw) title.appendChild(badge('自定义命中：' + hitKw, 'warn'));
    if (f.ruleLabel || f.ruleId) title.appendChild(h('span', { cls: 'badge badge-muted', text: f.ruleLabel || f.ruleId }));
    if (f.category) title.appendChild(badge(f.category, 'cat'));
    if (f.severity) title.appendChild(badge(SEVERITY_LABEL[f.severity] || f.severity, f.severity));
    main.appendChild(title);

    const meta = h('div', { cls: 'row-meta' });
    if (f.reason) meta.appendChild(h('span', { text: f.reason }));
    meta.appendChild(h('span', { text: '出现 ' + (f.count || 0) + ' 次' }));
    const ft = filesText(f.files);
    if (ft) meta.appendChild(h('span', { cls: 'row-files', text: ft }));
    main.appendChild(meta);

    const occs = f.occurrences || [];
    if (occs.length) {
      const toggle = h('button', {
        cls: 'occ-toggle', attrs: { type: 'button', 'aria-expanded': state.expanded[f.id] ? 'true' : 'false' },
        text: (state.expanded[f.id] ? '收起命中位置' : '查看命中位置') + '（' + occs.length + '）',
        on: {
          click: function () {
            state.expanded[f.id] = !state.expanded[f.id];
            const fresh = findingRow(f);
            if (row.parentNode) row.parentNode.replaceChild(fresh, row);
            const btn = fresh.querySelector('.occ-toggle');
            if (btn) btn.focus();
            renderSensStats();
          }
        }
      });
      main.appendChild(toggle);

      if (state.expanded[f.id]) {
        const list = h('div', { cls: 'occ-list' });
        occs.forEach(function (o) {
          const box = h('div', { cls: 'occ' });
          const head = h('div', { cls: 'occ-head' });
          head.appendChild(h('span', { text: (o.file || '') + ':' + (o.line === undefined ? '?' : o.line) + ':' + (o.col === undefined ? '?' : o.col) }));
          const kindBits = [];
          if (o.kind) kindBits.push(KIND_LABEL[o.kind] || o.kind);
          if (o.tag) kindBits.push('<' + o.tag + '>');
          if (o.attr) kindBits.push('@' + o.attr);
          if (kindBits.length) head.appendChild(h('span', { text: kindBits.join(' ') }));
          box.appendChild(head);
          box.appendChild(h('pre', { cls: 'occ-snippet' }, snippetFragment(o.snippet)));
          list.appendChild(box);
        });
        main.appendChild(list);
      }
    }

    const side = h('div', { cls: 'row-side' });
    side.appendChild(segmented('选择处理方式：' + (f.preview || f.value || ''), TEXT_ACTIONS, action, function (v) {
      state.decisions[f.id] = v;
      row.classList.toggle('kept', v === 'keep');
      updateSegUi(row, v);
      renderSensStats();
    }));
    row.appendChild(main);
    row.appendChild(side);
    return row;
  }

  function imageRow(im) {
    const action = state.imageDecisions[im.id] || 'mask';
    const hitKw = imageHit(im);
    const row = h('div', {
      cls: 'row img-row' + (hitKw ? ' custom-hit' : '') + (action === 'keep' ? ' kept' : ''),
      attrs: { 'data-id': im.id, 'data-kind': 'image' }
    });

    /* 缩略图：file:// 绝对路径；失败显示占位块 */
    const thumb = h('div', { cls: 'thumb' });
    const abs = String(im.path || '');
    if (!abs) {
      thumb.classList.add('thumb-fail');
      thumb.appendChild(h('span', { cls: 'thumb-fail-text', text: '无缩略图' }));
    } else {
      const img = h('img', { attrs: { alt: im.rel || '图片预览', loading: 'lazy' } });
      img.addEventListener('error', function () {
        clear(thumb);
        thumb.classList.add('thumb-fail');
        thumb.appendChild(h('span', { cls: 'thumb-fail-text', text: '无法预览' }));
      });
      img.src = 'file:///' + abs.replace(/\\/g, '/');
      thumb.appendChild(img);
    }
    row.appendChild(thumb);

    const main = h('div', { cls: 'row-main' });
    const title = h('div', { cls: 'row-title' });
    title.appendChild(h('span', { cls: 'value', text: im.rel || abs || '(未知图片)' }));
    if (hitKw) title.appendChild(badge('自定义命中：' + hitKw, 'warn'));
    if (im.isPortrait) title.appendChild(badge('人像照片', 'danger'));
    (im.tags || []).forEach(function (t) { title.appendChild(badge(String(t), 'muted')); });
    main.appendChild(title);

    const meta = h('div', { cls: 'img-meta' });
    if (im.w && im.h) meta.appendChild(h('span', { text: im.w + ' × ' + im.h }));
    else meta.appendChild(h('span', { text: '尺寸未知' }));
    meta.appendChild(h('span', { text: fmtBytes(im.bytes || 0) }));
    if (im.defaultAction) meta.appendChild(h('span', { text: '默认建议：' + ACTION_LABEL[im.defaultAction] }));
    main.appendChild(meta);

    if (im.gps && (im.gps.lat !== undefined || im.gps.lng !== undefined)) {
      const lat = im.gps.lat === undefined || im.gps.lat === null ? '?' : im.gps.lat;
      const lng = im.gps.lng === undefined || im.gps.lng === null ? '?' : im.gps.lng;
      main.appendChild(h('div', { cls: 'img-warn', text: '⚠ 照片含拍摄地点坐标（' + lat + ', ' + lng + '）' }));
    }
    if (im.exif) {
      const bits = [];
      if (im.exif.make) bits.push('设备 ' + im.exif.make);
      if (im.exif.model) bits.push(im.exif.model);
      if (im.exif.software) bits.push('软件 ' + im.exif.software);
      if (im.exif.datetime) bits.push('拍摄 ' + im.exif.datetime);
      if (bits.length) main.appendChild(h('div', { cls: 'img-exif', text: bits.join(' · ') }));
    }

    const side = h('div', { cls: 'row-side' });
    side.appendChild(segmented('图片处理方式：' + (im.rel || ''), IMAGE_ACTIONS, action, function (v) {
      state.imageDecisions[im.id] = v;
      row.classList.toggle('kept', v === 'keep');
      updateSegUi(row, v);
      renderSensStats();
    }));
    row.appendChild(main);
    row.appendChild(side);
    return row;
  }

  function renderKeywordCard() {
    const card = h('div', { cls: 'card' });
    card.appendChild(h('div', { cls: 'card-title', text: '自定义关键词' }));
    card.appendChild(h('div', { cls: 'card-sub', text: '例如你的真实姓名、学号、宿舍楼号。命中的条目会置顶并标记「自定义命中」。' }));

    const bar = h('div', { cls: 'kw-bar', attrs: { style: 'margin-top:10px' } });
    const input = h('input', {
      cls: 'input kw-input',
      attrs: { id: 'kwInput', type: 'text', placeholder: '输入关键词后点「添加」', autocomplete: 'off', spellcheck: 'false' }
    });
    const addBtn = h('button', { cls: 'btn', text: '添加', attrs: { type: 'button' } });
    const doAdd = function () {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      const exists = state.keywords.some(function (k) { return k.toLowerCase() === v.toLowerCase(); });
      if (exists) { toast('关键词已存在', 'warn'); return; }
      state.keywords.push(v);
      input.value = '';
      renderStepBody();
      const again = document.getElementById('kwInput');
      if (again) again.focus();
      toast('已添加关键词「' + v + '」，会随决定一起提交', 'ok');
    };
    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); doAdd(); }
    });
    bar.appendChild(input);
    bar.appendChild(addBtn);
    card.appendChild(bar);

    if (state.keywords.length) {
      const chips = h('div', { cls: 'kw-chips' });
      state.keywords.forEach(function (k) {
        const chip = h('span', { cls: 'kw-chip' });
        chip.appendChild(h('span', { cls: 'kw-text', text: k, attrs: { title: k } }));
        chip.appendChild(h('button', {
          cls: 'kw-chip-x', text: '×', attrs: { type: 'button', 'aria-label': '移除关键词 ' + k },
          on: {
            click: function () {
              state.keywords = state.keywords.filter(function (x) { return x !== k; });
              renderStepBody();
            }
          }
        }));
        chips.appendChild(chip);
      });
      card.appendChild(chips);
      const n = state.keywords.length;
      card.appendChild(h('div', { cls: 'notice notice-info', attrs: { style: 'margin-bottom:0' } }, [
        h('div', { text: '自定义关键词共 ' + n + ' 个：本页用于高亮与置顶匹配项，生成时会作为 options.customKeywords 随决定一起提交。' }),
        h('div', { cls: 'small dim', text: '说明：冻结契约 §6 未列出该字段，但主进程会读取它并作为补充规则参与脱敏（少于 2 个字的关键词会被忽略）。' })
      ]));
    }
    return card;
  }

  /* ==========================================================================
   * 9. 步骤 3：生成上线目录
   * ========================================================================*/
  function renderStep3(host) {
    const scan = state.scan;
    if (!scan) {
      host.appendChild(emptyState('还没有导入设计稿', '请回到第 1 步选择包含 index.html 的文件夹'));
      return;
    }

    /* 大文件清单 */
    const largeCard = h('div', { cls: 'card' });
    largeCard.appendChild(h('div', { cls: 'card-head' }, [
      h('div', {}, [
        h('div', { cls: 'card-title', text: '大文件清单' }),
        h('div', { cls: 'card-sub', text: '勾选 = 该文件「不上传」（会加入 exclude，站点里对应的引用会被移除）；默认全部勾选框为空，即全部上传。' })
      ])
    ]));
    const lf = scan.largeFiles || [];
    if (!lf.length) {
      largeCard.appendChild(h('div', { cls: 'small dim', text: '没有超过 50MB 的大文件，无需处理。' }));
    } else {
      const table = h('table', { cls: 'table' });
      table.appendChild(h('thead', {}, h('tr', {}, [
        h('th', { cls: 'check', text: '排除' }),
        h('th', { text: '文件' }),
        h('th', { text: '体积' }),
        h('th', { text: '处理' })
      ])));
      const tbody = h('tbody');
      lf.forEach(function (f) {
        const rel = f.rel || '';
        const checked = state.exclude.indexOf(rel) !== -1;
        const cb = h('input', {
          attrs: { type: 'checkbox', id: 'ex_' + rel, 'aria-label': '不上传 ' + rel },
          on: {
            change: function (ev) {
              if (ev.target.checked) { if (state.exclude.indexOf(rel) === -1) state.exclude.push(rel); }
              else state.exclude = state.exclude.filter(function (x) { return x !== rel; });
              renderStepBody();
            }
          }
        });
        if (checked) cb.checked = true;
        const tr = h('tr', {}, [
          h('td', { cls: 'check' }, cb),
          h('td', { cls: 'mono', text: rel }),
          h('td', { cls: 'num', text: fmtBytes(f.bytes) }),
          h('td', { cls: 'small ' + (checked ? 'dim' : 'muted'), text: checked ? '已排除，不会出现在上线目录' : '将上传（GitHub 可能变慢或拒绝大文件）' })
        ]);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      largeCard.appendChild(h('div', { cls: 'table-wrap' }, table));
    }
    host.appendChild(largeCard);

    /* 选项 */
    const optCard = h('div', { cls: 'card' });
    optCard.appendChild(h('div', { cls: 'card-title', attrs: { style: 'margin-bottom:12px' }, text: '生成选项' }));

    const cbExif = h('input', { attrs: { type: 'checkbox', id: 'optStripExif' }, on: { change: function (ev) { state.options.stripExif = ev.target.checked; } } });
    cbExif.checked = !!state.options.stripExif;
    optCard.appendChild(h('label', { cls: 'checkbox-row', attrs: { for: 'optStripExif' } }, [
      cbExif,
      h('div', { cls: 'cb-text' }, [
        h('div', { cls: 'cb-title', text: '清除照片里的 EXIF 与拍摄位置' }),
        h('div', { cls: 'cb-desc', text: '推荐开启：手机拍摄的照片常带 GPS 坐标、设备型号与拍摄时间，上线后会暴露这些信息。' })
      ])
    ]));

    const cbNotice = h('input', { attrs: { type: 'checkbox', id: 'optAddNotice' }, on: { change: function (ev) { state.options.addNotice = ev.target.checked; } } });
    cbNotice.checked = !!state.options.addNotice;
    optCard.appendChild(h('label', { cls: 'checkbox-row', attrs: { for: 'optAddNotice' } }, [
      cbNotice,
      h('div', { cls: 'cb-text' }, [
        h('div', { cls: 'cb-title', text: '在页面底部加一行「已脱敏」提示' }),
        h('div', { cls: 'cb-desc', text: '默认不勾选。开启后会在生成的页面底部加一行说明文字。' })
      ])
    ]));

    const titleInput = h('input', {
      cls: 'input', attrs: { id: 'optSiteTitle', type: 'text', placeholder: '留空则不修改 <title>', autocomplete: 'off' },
      on: { input: function (ev) { state.options.siteTitle = ev.target.value; } }
    });
    titleInput.value = state.options.siteTitle || '';
    optCard.appendChild(h('div', { cls: 'field' }, [
      h('label', { cls: 'field-label', attrs: { for: 'optSiteTitle' }, text: '站点标题（可选）' }),
      titleInput,
      h('div', { cls: 'field-hint', text: '填写后会覆盖生成页面里的 <title>。' })
    ]));

    const kwHint = state.keywords.length
      ? '自定义关键词 ' + state.keywords.length + ' 个将随决定一起提交（options.customKeywords）'
      : '暂无自定义关键词';
    optCard.appendChild(h('div', { cls: 'field-hint', text: kwHint }));

    const row = h('div', { cls: 'card-actions', attrs: { style: 'margin-top:14px' } });
    const buildBtn = h('button', { cls: 'btn btn-primary btn-lg', attrs: { type: 'button' }, text: state.building ? '正在生成…' : '生成上线目录' });
    if (state.building) { buildBtn.disabled = true; buildBtn.appendChild(spinner('tiny')); }
    buildBtn.addEventListener('click', doBuild);
    row.appendChild(buildBtn);

    const openList = h('button', { cls: 'btn', text: '打开工作区目录', attrs: { type: 'button' } });
    openList.addEventListener('click', function () {
      const ws = dd.app && dd.app.paths ? dd.app.paths.workspaces : null;
      if (ws) fire(dd.shell.openPath, ws);
      else toast('未获取到工作区目录', 'warn');
    });
    row.appendChild(openList);
    optCard.appendChild(row);

    const errHost = h('div', { attrs: { id: 'buildErr' } });
    if (state.err.build) errHost.appendChild(inlineErrorBox(state.err.build));
    optCard.appendChild(errHost);
    host.appendChild(optCard);

    if (state.buildResult) {
      host.appendChild(renderBuildResult(state.buildResult));
      host.appendChild(renderPreviewCard(state.buildResult));
    }
  }

  async function doBuild() {
    if (state.building) return;
    state.building = true;
    state.err.build = null;
    state.buildResult = null;
    state.preview = null;
    state.deployResult = null;
    renderStepBody();

    const options = {
      stripExif: !!state.options.stripExif,
      addNotice: !!state.options.addNotice,
      siteTitle: (state.options.siteTitle && state.options.siteTitle.trim()) || null,
      outParent: null
    };
    if (state.keywords.length) options.customKeywords = state.keywords.slice();

    const payload = {
      root: state.root,
      decisions: state.decisions,
      imageDecisions: state.imageDecisions,
      exclude: state.exclude.slice(),
      options: options
    };

    let res = null;
    try { res = await dd.build(payload); } catch (e) { res = null; }
    state.building = false;

    if (res && res.ok) {
      state.buildResult = res;
      state.maxStep = Math.max(state.maxStep, 4);
      toast('上线目录已生成', 'ok');
    } else {
      state.err.build = res ? err(res) : { code: 'E_UNKNOWN', message: '生成失败，未返回详细信息' };
    }
    renderStepBody();
  }

  function renderBuildResult(r) {
    const card = h('div', { cls: 'card card-accent' });
    const head = h('div', { cls: 'card-head' });
    const box = h('div');
    box.appendChild(h('div', { cls: 'card-title', text: '生成结果' }));
    box.appendChild(h('div', { cls: 'card-sub mono', text: r.outDir || '' }));
    head.appendChild(box);
    const actions = h('div', { cls: 'card-actions' });
    const openBtn = h('button', { cls: 'btn btn-sm', text: '打开目录', attrs: { type: 'button' } });
    openBtn.addEventListener('click', async function () {
      let res = null;
      try { res = await dd.shell.openPath(r.outDir); } catch (e) { res = null; }
      if (res && res.ok === false) toast('打开失败：' + errText(err(res)), 'danger');
    });
    actions.appendChild(openBtn);
    if (r.reportPath) {
      const repBtn = h('button', { cls: 'btn btn-sm', text: '打开脱敏报告', attrs: { type: 'button' } });
      repBtn.addEventListener('click', function () { fire(dd.shell.openPath, r.reportPath); });
      actions.appendChild(repBtn);
    }
    head.appendChild(actions);
    card.appendChild(head);

    /* 统计 */
    let masked = 0, deleted = 0, hiddenText = 0;
    (r.applied || []).forEach(function (a) {
      const c = Number(a.count) || 1;
      if (a.action === 'mask') masked += c;
      else if (a.action === 'delete') deleted += c;
      else if (a.action === 'hideblock') hiddenText += c;
    });
    const hiddenBlocks = Number(r.hiddenBlocks) || 0;
    const remaining = r.remaining || [];

    const grid = h('div', { cls: 'stat-grid' });
    grid.appendChild(statTile('打码处数', String(masked), 'ok', null));
    grid.appendChild(statTile('删除处数', String(deleted), 'ok', null));
    grid.appendChild(statTile('隐藏整块', String(hiddenBlocks), hiddenBlocks ? 'ok' : null, hiddenText ? ('涉及 ' + hiddenText + ' 处文本') : null));
    grid.appendChild(statTile('仍保留', String(remaining.length), remaining.length ? 'warn' : 'ok', remaining.length ? '这些内容会原样公开' : '没有残留项'));
    grid.appendChild(statTile('输出文件数', String((r.stats && r.stats.files) || 0), null, null));
    grid.appendChild(statTile('输出体积', fmtBytes((r.stats && r.stats.bytes) || 0), null, null));
    card.appendChild(grid);

    const excluded = r.excluded || r.removedRefs || [];
    if (excluded.length) {
      const list = h('ul');
      excluded.forEach(function (x) { list.appendChild(h('li', { text: typeof x === 'string' ? x : (x.rel || x.path || JSON.stringify(x)) })); });
      card.appendChild(h('div', { cls: 'notice notice-info' }, [
        h('div', { cls: 'notice-title', text: '已排除的文件（共 ' + excluded.length + ' 个）' }),
        list
      ]));
    }

    if (remaining.length) {
      const list = h('ul');
      remaining.forEach(function (x) {
        const files = filesText(x.files);
        list.appendChild(h('li', { text: (x.value || x.id || '') + '（' + (x.count || 0) + ' 处' + (files ? '，' + files : '') + '）' }));
      });
      card.appendChild(h('div', { cls: 'notice notice-warn' }, [
        h('div', { cls: 'notice-title', text: '仍有 ' + remaining.length + ' 项敏感信息被保留' }),
        h('div', { text: '这些内容将原样公开在网上。如果不想公开，请回到第 2 步把它们改成「打码 / 删除 / 隐藏整块」后重新生成。' }),
        list
      ]));
    } else {
      card.appendChild(h('div', { cls: 'notice notice-ok' }, [
        h('div', { cls: 'notice-title', text: '没有残留的敏感信息' }),
        h('div', { text: '所有被识别的内容都已按你的选择处理。' })
      ]));
    }

    const warnings = r.warnings || [];
    if (warnings.length) {
      const list = h('ul');
      warnings.forEach(function (w) { list.appendChild(h('li', { text: String(w) })); });
      card.appendChild(h('div', { cls: 'notice notice-info' }, [
        h('div', { cls: 'notice-title', text: '生成提示' }), list
      ]));
    }
    return card;
  }

  function renderPreviewCard(r) {
    const card = h('div', { cls: 'card' });
    card.appendChild(h('div', { cls: 'card-title', text: '本地预览' }));
    card.appendChild(h('div', { cls: 'card-sub', text: '在本机起一个静态服务器，确认脱敏效果没问题再上线。' }));

    const row = h('div', { cls: 'card-actions', attrs: { style: 'margin-top:12px' } });
    if (!state.preview) {
      const btn = h('button', { cls: 'btn btn-primary', text: state.previewBusy ? '正在启动…' : '本地预览', attrs: { type: 'button' } });
      if (state.previewBusy) { btn.disabled = true; btn.appendChild(spinner('tiny')); }
      btn.addEventListener('click', doPreviewStart);
      row.appendChild(btn);
    } else {
      const link = h('a', {
        cls: 'value', text: state.preview.url, attrs: { href: '#', role: 'link', title: '在浏览器中打开' },
        on: {
          click: function (ev) {
            ev.preventDefault();
            fire(dd.shell.openExternal, state.preview.url);
          }
        }
      });
      row.appendChild(link);
      row.appendChild(h('span', { cls: 'small dim', text: '端口 ' + (state.preview.port || '') }));
      const stop = h('button', { cls: 'btn btn-sm', text: state.previewBusy ? '正在停止…' : '停止预览', attrs: { type: 'button' } });
      if (state.previewBusy) { stop.disabled = true; stop.appendChild(spinner('tiny')); }
      stop.addEventListener('click', doPreviewStop);
      row.appendChild(stop);
    }
    card.appendChild(row);

    if (state.err.preview) card.appendChild(inlineErrorBox(state.err.preview));
    return card;
  }

  async function doPreviewStart() {
    const r = state.buildResult;
    if (!r || state.previewBusy) return;
    state.previewBusy = true;
    state.err.preview = null;
    renderStepBody();
    let res = null;
    try { res = await dd.preview.start({ dir: r.outDir }); } catch (e) { res = null; }
    state.previewBusy = false;
    if (res && res.ok) {
      state.preview = { url: res.url, port: res.port };
      toast('预览已启动：' + res.url, 'ok');
    } else {
      state.err.preview = res ? err(res) : { code: 'E_UNKNOWN', message: '启动预览失败' };
    }
    renderStepBody();
  }

  async function doPreviewStop() {
    if (state.previewBusy) return;
    state.previewBusy = true;
    state.err.preview = null;
    renderStepBody();
    let failed = null;
    try {
      const res = await dd.preview.stop();
      if (res && res.ok === false) failed = err(res);
    } catch (e) { failed = { code: 'E_UNKNOWN', message: (e && e.message) || '停止预览失败' }; }
    state.previewBusy = false;
    state.preview = null;
    if (failed) state.err.preview = failed;
    else toast('预览已停止', 'ok');
    renderStepBody();
  }

  /* ==========================================================================
   * 10. 步骤 4：上线到 GitHub Pages
   * ========================================================================*/
  function deployAuth() {
    return (state.tools && state.tools.auth) ? state.tools.auth : null;
  }

  function renderStep4(host) {
    const r = state.buildResult;
    if (!r) {
      host.appendChild(emptyState('还没有生成上线目录', '请回到第 3 步点击「生成上线目录」'));
      return;
    }
    if (!state.deployForm.repoName) {
      const name = (state.scan && state.scan.name) || basename(state.root || '') || '';
      state.deployForm.repoName = slugRepoName(name);
    }

    host.appendChild(renderLoginCard());
    host.appendChild(renderDeployForm(r));
    host.appendChild(renderDeployRunCard());
  }

  function renderLoginCard() {
    const card = h('div', { cls: 'card' });
    card.appendChild(h('div', { cls: 'card-title', text: 'GitHub 账号' }));

    const auth = deployAuth();
    if (auth && auth.loggedIn) {
      const acc = h('div', { cls: 'account', attrs: { style: 'margin-top:12px' } });
      acc.appendChild(h('div', { cls: 'avatar', text: String(auth.user || '?').charAt(0).toUpperCase() }));
      const info = h('div', { cls: 'account-info' });
      info.appendChild(h('div', { cls: 'account-name', text: auth.user || '已登录' }));
      const bits = [];
      if (auth.host) bits.push(auth.host);
      if (auth.protocol) bits.push(auth.protocol + ' 协议');
      if (auth.scopes && auth.scopes.length) bits.push('权限：' + auth.scopes.join(', '));
      info.appendChild(h('div', { cls: 'account-sub', text: bits.join(' · ') || '已通过 GitHub CLI 登录' }));
      acc.appendChild(info);
      card.appendChild(acc);
      const row = h('div', { cls: 'card-actions', attrs: { style: 'margin-top:12px' } });
      const re = h('button', { cls: 'btn btn-sm', text: '重新检测登录状态', attrs: { type: 'button' } });
      re.addEventListener('click', async function () {
        re.disabled = true;
        re.appendChild(spinner('tiny'));
        await ensureTools(true);
        renderStepBody();
      });
      row.appendChild(re);
      card.appendChild(row);
      return card;
    }

    card.appendChild(h('div', { cls: 'card-sub', text: '上线需要 GitHub 账号授权，本程序不会保存你的密码。' }));

    const loginBtn = h('button', { cls: 'btn btn-primary btn-lg btn-block', attrs: { type: 'button', style: 'margin-top:14px' },
      text: state.authPending ? '等待浏览器授权…' : '登录 GitHub 账号' });
    if (state.authPending) { loginBtn.disabled = true; loginBtn.appendChild(spinner('tiny')); }
    loginBtn.addEventListener('click', doLoginGithub);
    card.appendChild(loginBtn);

    if (state.authPending) {
      card.appendChild(h('div', { cls: 'notice notice-info' }, [
        h('div', { text: '已弹出终端窗口，请在浏览器中完成授权，完成后本页会自动继续。' })
      ]));
    }
    if (state.err.login) card.appendChild(inlineErrorBox(state.err.login));

    const toggle = h('button', { cls: 'btn-link', attrs: { type: 'button', style: 'margin-top:14px' }, text: state.tokenOpen ? '收起访问令牌登录' : '使用访问令牌登录' });
    toggle.addEventListener('click', function () { state.tokenOpen = !state.tokenOpen; renderStepBody(); });
    card.appendChild(toggle);

    if (state.tokenOpen) {
      const box = h('div', { cls: 'token-box' });
      const input = h('input', { cls: 'input', attrs: { id: 'ghToken', type: 'password', placeholder: '粘贴 GitHub Personal Access Token', autocomplete: 'off' } });
      const btn = h('button', { cls: 'btn', text: '用令牌登录', attrs: { type: 'button' } });
      const doSubmit = async function () {
        const token = input.value.trim();
        if (!token) { input.focus(); return; }
        btn.disabled = true;
        btn.textContent = '正在登录…';
        btn.appendChild(spinner('tiny'));
        state.err.login = null;
        let res = null;
        try { res = await dd.tools.loginWithToken(token); } catch (e) { res = null; }
        input.value = '';
        if (res && res.ok) {
          toast('已登录：' + (res.user || ''), 'ok');
          state.tokenOpen = false;
          await ensureTools(true);
        } else {
          state.err.login = res ? err(res) : { code: 'E_UNKNOWN', message: '令牌登录失败' };
        }
        renderStepBody();
      };
      btn.addEventListener('click', doSubmit);
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doSubmit(); } });
      box.appendChild(h('div', { cls: 'field-label', text: '访问令牌（需要 repo 权限）' }));
      const ir = h('div', { cls: 'input-row' }, [input, btn]);
      box.appendChild(ir);
      box.appendChild(h('div', { cls: 'field-hint', text: '令牌只用于本次登录，由 GitHub CLI 保存在本机凭据里。' }));
      box.appendChild(h('div', { cls: 'inline-error-tip', text: '提示：如果登录后仍未生效，点上面的「重新检测登录状态」。' }));
      card.appendChild(box);
      window.setTimeout(function () { const el = document.getElementById('ghToken'); if (el) el.focus(); }, 0);
    }
    return card;
  }

  async function doLoginGithub() {
    if (state.authPending) return;
    state.authPending = true;
    state.err.login = null;
    renderStepBody();
    startAuthPolling();

    let res = null;
    try { res = await dd.tools.loginGithub(); } catch (e) { res = null; }
    stopAuthPolling();
    state.authPending = false;

    if (res && res.ok) {
      toast('已登录：' + (res.user || ''), 'ok');
      await ensureTools(true);
    } else {
      state.err.login = res ? err(res) : { code: 'E_UNKNOWN', message: '登录失败，未返回详细信息' };
    }
    renderStepBody();
  }

  /* 等待授权期间每 3 秒轮询一次 tools.status() */
  function startAuthPolling() {
    stopAuthPolling();
    authPoller = window.setInterval(async function () {
      let res = null;
      try { res = await dd.tools.status(); } catch (e) { res = null; }
      if (res && res.ok && res.tools) {
        state.tools = res.tools;
        renderToolsPanel();
        if (res.tools.auth && res.tools.auth.loggedIn) {
          stopAuthPolling();
          state.authPending = false;
          if (state.step === 4) renderStepBody();
        }
      }
    }, 3000);
  }
  function stopAuthPolling() {
    if (authPoller !== null) { window.clearInterval(authPoller); authPoller = null; }
  }

  function renderDeployForm(r) {
    const form = state.deployForm;
    const card = h('div', { cls: 'card form-card' });
    card.appendChild(h('div', { cls: 'card-title', text: '仓库与站点设置' }));
    card.appendChild(h('div', { cls: 'card-sub mono', text: '源目录：' + (r.outDir || '') }));

    /* 仓库名 */
    const repoInput = h('input', {
      cls: 'input', attrs: { id: 'fieldRepoName', type: 'text', placeholder: 'my-portfolio', autocomplete: 'off', spellcheck: 'false' },
      on: {
        input: function (ev) {
          state.deployForm.repoName = ev.target.value;
          state.deployForm.repoNameTouched = true;
        }
      }
    });
    repoInput.value = form.repoName;
    const repoField = h('div', { cls: 'field', attrs: { style: 'margin-top:14px' } });
    repoField.appendChild(h('label', { cls: 'field-label', attrs: { for: 'fieldRepoName' }, text: '仓库名' }));
    const repoRow = h('div', { cls: 'input-row' }, repoInput);
    const regen = h('button', { cls: 'btn btn-sm', text: '按站点名生成', attrs: { type: 'button' } });
    regen.addEventListener('click', function () {
      state.deployForm.repoName = slugRepoName((state.scan && state.scan.name) || basename(state.root || ''));
      state.deployForm.repoNameTouched = true;
      renderStepBody();
    });
    repoRow.appendChild(regen);
    repoField.appendChild(repoRow);

    if (form.siteType === 'user') {
      const auth = deployAuth();
      const user = auth && auth.user ? auth.user : '用户名';
      repoField.appendChild(h('div', { cls: 'field-hint warn', text: '用户站点的仓库名必须是 ' + user + '.github.io，访问链接为 https://' + user + '.github.io/' }));
      const useUser = h('button', { cls: 'btn-link', attrs: { type: 'button', style: 'margin-top:6px' }, text: '把仓库名填成 ' + user + '.github.io' });
      useUser.addEventListener('click', function () {
        state.deployForm.repoName = user + '.github.io';
        state.deployForm.repoNameTouched = true;
        renderStepBody();
      });
      repoField.appendChild(useUser);
    } else {
      const preview = String(form.repoName || '').trim() || slugRepoName((state.scan && state.scan.name) || basename(state.root || ''));
      repoField.appendChild(h('div', { cls: 'field-hint', text: '链接会形如 https://用户名.github.io/' + preview + '/' }));
    }
    card.appendChild(repoField);

    /* 描述 */
    const descInput = h('input', {
      cls: 'input', attrs: { id: 'fieldDesc', type: 'text', placeholder: '个人作品展示网站', autocomplete: 'off' },
      on: { input: function (ev) { state.deployForm.description = ev.target.value; } }
    });
    descInput.value = form.description;
    card.appendChild(h('div', { cls: 'field' }, [
      h('label', { cls: 'field-label', attrs: { for: 'fieldDesc' }, text: '仓库描述' }), descInput
    ]));

    /* 站点类型 */
    const typeBox = h('div', { cls: 'field' });
    typeBox.appendChild(h('div', { cls: 'field-label', text: '站点类型' }));
    const typeRow = h('div', { cls: 'radio-row' });
    [['project', '项目站点', '链接为 https://用户名.github.io/仓库名/'],
     ['user', '用户站点', '链接为 https://用户名.github.io/，仓库名必须是 用户名.github.io']].forEach(function (pair) {
      const checked = form.siteType === pair[0];
      const input = h('input', {
        attrs: { type: 'radio', name: 'siteType', id: 'st_' + pair[0], value: pair[0] },
        on: { change: function () { state.deployForm.siteType = pair[0]; renderStepBody(); } }
      });
      if (checked) input.checked = true;
      typeRow.appendChild(h('label', { cls: 'radio-card' + (checked ? ' checked' : ''), attrs: { for: 'st_' + pair[0] } }, [
        input,
        h('div', {}, [h('div', { cls: 'rc-title', text: pair[1] }), h('div', { cls: 'rc-desc', text: pair[2] })])
      ]));
    });
    typeBox.appendChild(typeRow);
    card.appendChild(typeBox);

    /* 可见性 */
    const visBox = h('div', { cls: 'field' });
    visBox.appendChild(h('div', { cls: 'field-label', text: '仓库可见性' }));
    const visRow = h('div', { cls: 'radio-row' });
    [['public', '公开', '任何人都能看到源码与页面，GitHub Pages 免费可用'],
     ['private', '私有', '源码不公开，但 GitHub Pages 对私有仓库需要付费账号']].forEach(function (pair) {
      const checked = form.visibility === pair[0];
      const input = h('input', {
        attrs: { type: 'radio', name: 'visibility', id: 'vis_' + pair[0], value: pair[0] },
        on: { change: function () { state.deployForm.visibility = pair[0]; renderStepBody(); } }
      });
      if (checked) input.checked = true;
      visRow.appendChild(h('label', { cls: 'radio-card' + (checked ? ' checked' : ''), attrs: { for: 'vis_' + pair[0] } }, [
        input,
        h('div', {}, [h('div', { cls: 'rc-title', text: pair[1] }), h('div', { cls: 'rc-desc', text: pair[2] })])
      ]));
    });
    visBox.appendChild(visRow);
    if (form.visibility === 'private') {
      visBox.appendChild(h('div', { cls: 'notice notice-warn', attrs: { style: 'margin-bottom:0' } }, [
        h('div', { text: 'GitHub Pages 对私有仓库需要付费账号，免费账号会失败。' })
      ]));
    }
    card.appendChild(visBox);

    /* 提交信息 */
    const cmInput = h('input', {
      cls: 'input', attrs: { id: 'fieldCommit', type: 'text', autocomplete: 'off' },
      on: { input: function (ev) { state.deployForm.commitMessage = ev.target.value; } }
    });
    cmInput.value = form.commitMessage;
    card.appendChild(h('div', { cls: 'field' }, [
      h('label', { cls: 'field-label', attrs: { for: 'fieldCommit' }, text: '提交信息' }), cmInput
    ]));

    /* 仓库已存在时的自定义确认条（不用 window.confirm） */
    if (state.repoExists) {
      const confirmBar = h('div', { cls: 'notice notice-warn' });
      confirmBar.appendChild(h('div', { cls: 'notice-title', text: '仓库 ' + form.repoName + ' 已经存在' }));
      confirmBar.appendChild(h('div', { text: '要覆盖推送（复用该仓库）还是换一个仓库名？决定后会写入表单，请再点一次「开始上线」。' }));
      const btns = h('div', { cls: 'card-actions', attrs: { style: 'margin-top:10px' } });
      const reuseBtn = h('button', { cls: 'btn btn-danger btn-sm', text: '覆盖推送（reuse: true）', attrs: { type: 'button' } });
      reuseBtn.addEventListener('click', function () {
        state.deployForm.reuse = true;
        state.repoExists = false;
        toast('已选择覆盖推送，请再次点击「开始上线」', 'warn');
        renderStepBody();
      });
      const renameBtn = h('button', { cls: 'btn btn-sm', text: '换个仓库名', attrs: { type: 'button' } });
      renameBtn.addEventListener('click', function () {
        state.deployForm.reuse = false;
        state.repoExists = false;
        renderStepBody();
        const el = document.getElementById('fieldRepoName');
        if (el) { el.focus(); el.select(); }
      });
      btns.appendChild(reuseBtn);
      btns.appendChild(renameBtn);
      confirmBar.appendChild(btns);
      card.appendChild(confirmBar);
    }

    card.appendChild(h('div', { cls: 'field-hint', text: state.deployForm.reuse ? '当前模式：覆盖推送已存在的仓库（reuse: true）' : '当前模式：仓库已存在时报错并询问（reuse: false）' }));

    const runRow = h('div', { cls: 'card-actions', attrs: { style: 'margin-top:14px' } });
    const deployBtn = h('button', { cls: 'btn btn-primary btn-lg', text: state.deploying ? '正在上线…' : '开始上线', attrs: { type: 'button' } });
    if (state.deploying) { deployBtn.disabled = true; deployBtn.appendChild(spinner('tiny')); }
    deployBtn.addEventListener('click', doDeploy);
    runRow.appendChild(deployBtn);
    card.appendChild(runRow);

    const errHost = h('div', { attrs: { id: 'deployErr' } });
    if (state.err.deploy) errHost.appendChild(inlineErrorBox(state.err.deploy));
    card.appendChild(errHost);
    return card;
  }

  async function doDeploy() {
    if (state.deploying) return;
    const r = state.buildResult;
    const form = state.deployForm;
    const auth = deployAuth();

    /* 仓库名：用户显式填写的原样使用（保留用户站点所需的点号），留空则由站点名生成 */
    const rawName = String(form.repoName || '').trim();
    const siteName = (state.scan && state.scan.name) || basename(state.root || '');
    const repoName = rawName || slugRepoName(siteName);
    if (!/^[A-Za-z0-9._-]+$/.test(repoName)) {
      state.err.deploy = {
        code: 'E_BAD_INPUT',
        message: '仓库名只能包含字母、数字、点、连字符与下划线，当前是「' + repoName + '」',
        tip: '点仓库名右侧的「按站点名生成」可以自动生成一个合法的名字。'
      };
      renderStepBody();
      return;
    }
    if (form.siteType === 'user') {      const user = auth && auth.user ? auth.user : '';
      const want = user ? (user + '.github.io') : '';
      if (!user || repoName !== want) {
        state.err.deploy = {
          code: 'E_BAD_INPUT',
          message: '用户站点的仓库名必须是 ' + (want || '用户名.github.io') + '，当前是 ' + repoName,
          tip: '可以点击「按站点名生成」旁边的链接一键填入，或改成「项目站点」。'
        };
        renderStepBody();
        return;
      }
    }
    if (!(auth && auth.loggedIn)) {
      state.err.deploy = { code: 'E_NOT_LOGGED_IN', message: '请先登录 GitHub 账号', tip: '点上面的「登录 GitHub 账号」，完成浏览器授权后本页会自动继续。' };
      renderStepBody();
      return;
    }

    state.deploying = true;
    state.err.deploy = null;
    state.repoExists = false;
    state.deployResult = null;
    state.logs = [];
    state.progress = null;
    renderStepBody();

    const payload = {
      dir: r.outDir,
      repoName: repoName,
      description: form.description,
      siteType: form.siteType,
      visibility: form.visibility,
      reuse: !!form.reuse,
      commitMessage: form.commitMessage,
      // 上线后主进程会抓取真实链接，核对这些「已选择隐藏」的原值是否还在线上页面里
      forbiddenValues: (r.applied || []).filter(function (a) { return a && a.action !== 'keep' && a.value; }).map(function (a) { return a.value; }),
      reportPath: r.reportPath || null
    };

    let res = null;
    try { res = await dd.deploy(payload); } catch (e) { res = null; }
    state.deploying = false;

    if (res && res.ok) {
      state.deployResult = res;
      state.maxStep = 5;
      state.step = 5;
      toast('上线成功', 'ok');
      render();
      return;
    }

    const e = res ? err(res) : { code: 'E_UNKNOWN', message: '上线失败，未返回详细信息' };
    state.err.deploy = e;
    if (e.code === 'E_REPO_EXISTS') {
      state.repoExists = true;
    }
    renderStepBody();
  }

  function renderDeployRunCard() {
    const card = h('div', { cls: 'card' });
    card.appendChild(h('div', { cls: 'card-title', text: '上线进度' }));

    const wrap = h('div', { cls: 'progress-wrap', attrs: { id: 'deployProgress', style: 'margin-top:12px' } });
    const head = h('div', { cls: 'progress-head' });
    head.appendChild(h('div', { cls: 'progress-label', attrs: { id: 'deployProgressLabel' }, text: '等待开始…' }));
    head.appendChild(h('div', { cls: 'small dim', attrs: { id: 'deployProgressHint' }, text: 'git init → commit → push → 开启 Pages → 复核' }));
    wrap.appendChild(head);
    const track = h('div', { cls: 'progress-track', attrs: { id: 'deployProgressTrack' } });
    track.appendChild(h('div', { cls: 'progress-bar', attrs: { id: 'deployProgressBar' } }));
    wrap.appendChild(track);
    card.appendChild(wrap);

    card.appendChild(h('div', { cls: 'card-head', attrs: { style: 'margin-bottom:8px' } }, [
      h('div', { cls: 'small muted', text: '实时日志（最多保留 500 行）' }),
      h('div', { cls: 'small dim', attrs: { id: 'logCount' }, text: state.logs.length ? state.logs.length + ' 行' : '' })
    ]));

    const panel = h('div', { cls: 'log-panel', attrs: { id: 'logPanel', role: 'log', 'aria-live': 'polite', tabindex: '0' } });
    if (!state.logs.length) {
      panel.appendChild(h('div', { cls: 'log-empty', text: state.deploying ? '正在等待主进程输出…' : '点击「开始上线」后，这里会显示每一步的命令与结果。' }));
    } else {
      state.logs.forEach(function (e) { panel.appendChild(logLine(e)); });
    }
    card.appendChild(panel);

    window.setTimeout(function () {
      const p = document.getElementById('logPanel');
      if (p) p.scrollTop = p.scrollHeight;
      updateProgressDom();
    }, 0);
    return card;
  }

  function logLine(e) {
    const level = (e && e.level) || 'info';
    const line = h('div', { cls: 'log-line log-' + level });
    line.appendChild(h('span', { cls: 'log-time', text: fmtTime(e && e.ts) }));
    line.appendChild(h('span', { cls: 'log-level', text: LOG_LEVEL_LABEL[level] || level }));
    const msg = h('span', { cls: 'log-msg' });
    msg.textContent = String((e && e.message) || '');
    if (e && e.scope) msg.setAttribute('title', 'scope: ' + e.scope);
    line.appendChild(msg);
    return line;
  }

  function onLogEvent(e) {
    if (!e) return;
    state.logs.push(e);
    if (state.logs.length > MAX_LOG_LINES) state.logs.splice(0, state.logs.length - MAX_LOG_LINES);

    const panel = document.getElementById('logPanel');
    if (panel) {
      const empty = panel.querySelector('.log-empty');
      if (empty) panel.removeChild(empty);
      panel.appendChild(logLine(e));
      while (panel.childElementCount > MAX_LOG_LINES) panel.removeChild(panel.firstElementChild);
      panel.scrollTop = panel.scrollHeight;
    }
    const counter = document.getElementById('logCount');
    if (counter) counter.textContent = state.logs.length + ' 行';
  }

  function onProgressEvent(e) {
    state.progress = e;

    // 网页生成的进度在「开始」这一步显示，直接更新 DOM，避免整页重绘打断输入
    if (e && e.scope === 'make') {
      state.gen.progress = e;
      const label = document.getElementById('genProgressLabel');
      const bar = document.getElementById('genProgressBar');
      if (label) label.textContent = e.label || '';
      if (bar) bar.style.width = (e.percent == null ? 6 : Math.max(4, e.percent)) + '%';
      return;
    }

    updateProgressDom();
  }

  function updateProgressDom() {
    const wrap = document.getElementById('deployProgress');
    const track = document.getElementById('deployProgressTrack');
    const bar = document.getElementById('deployProgressBar');
    const label = document.getElementById('deployProgressLabel');
    if (!wrap || !track || !bar || !label) return;

    const p = state.progress;
    if (!p) {
      label.textContent = '等待开始…';
      track.classList.remove('indeterminate');
      bar.style.width = '0%';
      return;
    }
    /* 契约与主进程一致：percent 为 0~100 的数值，null 表示不确定进度 */
    let pct = Number(p.percent);
    let known = isFinite(pct) && p.percent !== null && p.percent !== undefined;
    if (known) pct = Math.max(0, Math.min(100, pct));

    label.textContent = (p.label || '进行中') + (known ? ' · ' + Math.round(pct) + '%' : '');
    if (known) {
      track.classList.remove('indeterminate');
      bar.style.width = pct + '%';
    } else {
      track.classList.add('indeterminate');
      bar.style.width = '';
    }
  }

  /* ==========================================================================
   * 11. 步骤 5：完成
   * ========================================================================*/
  function renderStep5(host) {
    const r = state.deployResult;
    if (!r) {
      host.appendChild(emptyState('还没有上线结果', '请回到第 4 步完成上线'));
      return;
    }
    const url = r.url || '';
    const hero = h('div', { cls: 'card card-accent hero' });
    hero.appendChild(h('div', { cls: 'card-title', text: '🎉 站点已上线' }));
    hero.appendChild(h('div', { cls: 'card-sub', text: '点下面的链接会用系统浏览器打开你的站点。' }));

    const link = h('a', {
      cls: 'big-link', text: url || '（未返回链接）',
      attrs: { href: '#', role: 'link', title: '在浏览器中打开' },
      on: {
        click: function (ev) {
          ev.preventDefault();
          if (url) fire(dd.shell.openExternal, url);
        }
      }
    });
    hero.appendChild(link);

    const copyBtn = h('button', { cls: 'btn btn-primary btn-lg', text: '复制链接', attrs: { type: 'button' } });
    let copyTimer = null;
    copyBtn.addEventListener('click', async function () {
      let failed = null;
      try {
        const res = await dd.clipboard.write(url);
        if (res && res.ok === false) failed = err(res);
      } catch (e) {
        failed = { code: 'E_UNKNOWN', message: (e && e.message) || '写剪贴板失败' };
      }
      if (failed) { toast('复制失败：' + errText(failed), 'danger'); return; }
      copyBtn.textContent = '已复制 ✓';
      copyBtn.classList.add('btn-ok');
      if (copyTimer) window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(function () {
        copyBtn.textContent = '复制链接';
        copyBtn.classList.remove('btn-ok');
      }, 2000);
    });
    const heroActions = h('div', { cls: 'card-actions', attrs: { style: 'justify-content:center;margin-top:6px' } });
    heroActions.appendChild(copyBtn);
    const repoBtn = h('button', { cls: 'btn', text: '打开仓库', attrs: { type: 'button' } });
    repoBtn.addEventListener('click', function () { if (r.repoUrl) fire(dd.shell.openExternal, r.repoUrl); });
    heroActions.appendChild(repoBtn);
    if (r.pages && r.pages.buildLogUrl) {
      const logBtn = h('button', { cls: 'btn', text: '查看构建日志', attrs: { type: 'button' } });
      logBtn.addEventListener('click', function () { fire(dd.shell.openExternal, r.pages.buildLogUrl); });
      heroActions.appendChild(logBtn);
    }
    hero.appendChild(heroActions);
    host.appendChild(hero);

    /* 详情 */
    const detail = h('div', { cls: 'card' });
    detail.appendChild(h('div', { cls: 'card-title', attrs: { style: 'margin-bottom:10px' }, text: '上线详情' }));
    detail.appendChild(kvRow('仓库地址', r.repoUrl || '—', r.repoUrl ? function () { fire(dd.shell.openExternal, r.repoUrl); } : null, '打开'));
    detail.appendChild(kvRow('仓库全名', (r.owner ? r.owner + '/' : '') + (r.repo || ''), null, null));
    detail.appendChild(kvRow('站点类型', r.siteType === 'user' ? '用户站点' : '项目站点', null, null));
    detail.appendChild(kvRow('Pages 状态', (r.pages && r.pages.status) || '未知', r.pages && r.pages.htmlUrl ? function () { fire(dd.shell.openExternal, r.pages.htmlUrl); } : null, 'Pages 设置'));

    const httpsEnforced = !!(r.pages && r.pages.httpsEnforced);
    const httpsRow = h('div', { cls: 'kv' });
    httpsRow.appendChild(h('div', { cls: 'kv-k', text: 'HTTPS 强制开启' }));
    const httpsVal = h('div', { cls: 'kv-v check-line' });
    httpsVal.appendChild(h('span', { cls: httpsEnforced ? 'mark-ok' : 'mark-bad', text: httpsEnforced ? '✓' : '✗' }));
    httpsVal.appendChild(h('span', { text: httpsEnforced ? '已开启（访问会自动跳转 https）' : '未开启，可在仓库 Pages 设置里手动开启' }));
    httpsRow.appendChild(httpsVal);
    detail.appendChild(httpsRow);

    if (r.commitSha) detail.appendChild(kvRow('提交', String(r.commitSha).slice(0, 10), null, null));
    if (r.pushedBytes) detail.appendChild(kvRow('推送体积', fmtBytes(r.pushedBytes), null, null));
    detail.appendChild(h('div', { cls: 'notice notice-info' }, [
      h('div', { text: 'Pages 首次构建可能需要 1~3 分钟，如果链接暂时 404，请稍等后再刷新。' })
    ]));
    host.appendChild(detail);

    /* 复核报告 */
    const verify = r.verify;
    const vCard = h('div', { cls: 'card' });
    vCard.appendChild(h('div', { cls: 'card-title', attrs: { style: 'margin-bottom:10px' }, text: '上线复核报告' }));
    if (!verify) {
      vCard.appendChild(h('div', { cls: 'small dim', text: '主进程未返回复核结果。' }));
    } else if (verify.leftover && verify.leftover.length) {
      const list = h('ul');
      verify.leftover.forEach(function (x) {
        let text;
        if (typeof x === 'string') text = x;
        else if (x && typeof x === 'object') {
          text = String(x.value !== undefined ? x.value : JSON.stringify(x));
          if (x.count) text += '（' + x.count + ' 处）';
          if (x.files && x.files.length) text += ' · ' + x.files.join('、');
        } else text = String(x);
        list.appendChild(h('li', { text: text }));
      });
      vCard.appendChild(h('div', { cls: 'notice notice-danger' }, [
        h('div', { cls: 'notice-title', text: '线上页面仍能找到以下原值' }),
        h('div', { text: '请回到第 2 步调整为「打码 / 删除 / 隐藏整块」后重新生成并覆盖推送。' }),
        list
      ]));
    } else if (verify.ok) {
      const checked = Number(verify.checkedValues || 0);
      vCard.appendChild(h('div', { cls: 'notice notice-ok' }, [
        h('div', { cls: 'notice-title', text: '✓ 线上页面已复核，未发现残留的敏感信息' }),
        h('div', {
          text:
            (checked > 0
              ? '已在真实链接上核对了 ' + checked + ' 个「你选择隐藏」的原值，都没有出现在线上页面里。'
              : '没有可核对的原值（本次没有隐藏任何内容）。') +
            ' 复核时间：' + (verify.checkedAt ? String(verify.checkedAt) : '刚刚') + (verify.httpStatus ? ' · HTTP ' + verify.httpStatus : '')
        })
      ]));
    } else {
      vCard.appendChild(h('div', { cls: 'notice notice-warn' }, [
        h('div', { cls: 'notice-title', text: '复核未通过' }),
        h('div', { text: 'HTTP 状态：' + (verify.httpStatus === undefined ? '未知' : verify.httpStatus) + '，页面可能还没构建完成。' })
      ]));
    }

    const warnings = r.warnings || [];
    if (warnings.length) {
      const list = h('ul');
      warnings.forEach(function (w) { list.appendChild(h('li', { text: String(w) })); });
      vCard.appendChild(h('div', { cls: 'notice notice-warn' }, [
        h('div', { cls: 'notice-title', text: '上线提示' }), list
      ]));
    }
    host.appendChild(vCard);

    const again = h('div', { cls: 'card', attrs: { style: 'text-align:center' } });
    const againBtn = h('button', { cls: 'btn btn-lg', text: '再上线一个站点', attrs: { type: 'button' } });
    againBtn.addEventListener('click', resetAll);
    again.appendChild(againBtn);
    again.appendChild(h('div', { cls: 'small dim', attrs: { style: 'margin-top:8px' }, text: '会清空当前站点的导入、选择与上线结果，回到第 1 步重新开始。' }));
    host.appendChild(again);
  }

  function kvRow(key, value, onOpen, openLabel) {
    const row = h('div', { cls: 'kv' });
    row.appendChild(h('div', { cls: 'kv-k', text: key }));
    const v = h('div', { cls: 'kv-v' });
    v.appendChild(h('span', { text: value === undefined || value === null || value === '' ? '—' : String(value) }));
    if (onOpen) {
      v.appendChild(document.createTextNode(' '));
      const b = h('button', { cls: 'btn-link', text: openLabel || '打开', attrs: { type: 'button' } });
      b.addEventListener('click', onOpen);
      v.appendChild(b);
    }
    row.appendChild(v);
    return row;
  }

  function resetAll() {
    stopAuthPolling();
    if (state.preview) fire(dd.preview.stop, null);
    state.step = 1;
    state.maxStep = 1;
    state.root = null;
    state.scan = null;
    state.scanning = false;
    state.decisions = {};
    state.imageDecisions = {};
    state.exclude = [];
    state.options = { stripExif: true, addNotice: false, siteTitle: '' };
    state.building = false;
    state.buildResult = null;
    state.deployResult = null;
    state.deploying = false;
    state.repoExists = false;
    state.progress = null;
    state.logs = [];
    state.keywords = [];
    state.filter = 'all';
    state.expanded = {};
    state.preview = null;
    state.previewBusy = false;
    state.tokenOpen = false;
    state.err = { scan: null, build: null, deploy: null, login: null, preview: null, tools: null };
    state.deployForm.repoName = '';
    state.deployForm.repoNameTouched = false;
    state.deployForm.reuse = false;
    render();
    toast('已重置，可以导入下一个站点', 'ok');
  }

  function emptyState(title, sub) {
    const box = h('div', { cls: 'empty' });
    box.appendChild(h('div', { cls: 'empty-title', text: title }));
    if (sub) box.appendChild(h('div', { cls: 'empty-sub', text: sub }));
    return box;
  }

  /* ==========================================================================
   * 12. 拖拽（window 级阻止默认，避免 Electron 直接打开文件）
   * ========================================================================*/
  let dragDepth = 0;

  function isFileDrag(ev) {
    const dt = ev.dataTransfer;
    if (!dt) return false;
    if (dt.types) {
      for (let i = 0; i < dt.types.length; i++) {
        if (dt.types[i] === 'Files') return true;
      }
    }
    return false;
  }

  function bindDragEvents() {
    window.addEventListener('dragover', function (ev) { ev.preventDefault(); ev.dataTransfer && (ev.dataTransfer.dropEffect = 'copy'); }, false);
    window.addEventListener('drop', function (ev) { ev.preventDefault(); }, false);
    window.addEventListener('dragenter', function (ev) {
      ev.preventDefault();
      if (!isFileDrag(ev)) return;
      dragDepth++;
      const dz = document.getElementById('dropzone');
      if (dz) dz.classList.add('hot');
    }, false);
    window.addEventListener('dragleave', function (ev) {
      if (!isFileDrag(ev)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        const dz = document.getElementById('dropzone');
        if (dz) dz.classList.remove('hot');
      }
    }, false);
    window.addEventListener('drop', function (ev) { handleDrop(ev); }, false);
  }

  async function handleDrop(ev) {
    dragDepth = 0;
    const dz = document.getElementById('dropzone');
    if (dz) dz.classList.remove('hot');
    if (state.scanning) return;

    const dt = ev.dataTransfer;
    const files = dt && dt.files ? Array.prototype.slice.call(dt.files) : [];
    if (!files.length) { toast('没有读取到文件，请重试或使用「选择文件夹」', 'warn'); return; }

    const paths = [];
    files.forEach(function (f) {
      let p = '';
      try { p = dd.file.pathForFile(f) || ''; } catch (e) { p = ''; }
      if (p && paths.indexOf(p) === -1) paths.push(p);
    });
    if (!paths.length) {
      toast('无法获取拖入文件的真实路径，请改用「选择文件夹」', 'warn');
      return;
    }

    const html = paths.filter(isHtmlPath)[0];
    let root;
    if (html) root = dirname(html);          // 拖入 index.html → 取其所在目录
    else root = paths[0];                    // 拖入目录 → 直接作为 root
    await startScan(root);
  }

  /* ==========================================================================
   * 13. 事件订阅 / 初始化 / 清理
   * ========================================================================*/
  function subscribe() {
    const on = function (type, handler) {
      if (!dd || typeof dd.on !== 'function') return;
      try {
        const off = dd.on(type, handler);
        if (typeof off === 'function') state.offs.push(off);
      } catch (e) { /* 订阅失败不影响界面 */ }
    };
    on('log', onLogEvent);
    on('progress', onProgressEvent);
    on('tools', function (t) {
      if (!t) return;
      state.tools = t;
      renderToolsPanel();     // 只刷新侧栏，不做整页重渲染
      if (state.step === 4 && t.auth && t.auth.loggedIn && state.authPending) {
        stopAuthPolling();
        state.authPending = false;
        renderStepBody();
      }
    });
  }

  function cleanup() {
    stopAuthPolling();
    state.offs.forEach(function (off) {
      try { off(); } catch (e) { /* 忽略 */ }
    });
    state.offs = [];
  }

  function init() {
    buildShell();
    bindDragEvents();
    subscribe();
    window.addEventListener('beforeunload', cleanup, { once: true });
    window.addEventListener('unload', cleanup, { once: true });
    renderToolsPanel();
    ensureTools(false);   // 进入第 1 步即检测环境并自动安装缺失插件
    render();
  }

  /* ==========================================================================
   * 14. 启动
   * ========================================================================*/
  onReady(function () {
    if (!dd) { showFatal('请在 Electron 桌面程序中运行'); return; }
    try { init(); } catch (e) { showFatal('界面初始化失败：' + ((e && e.message) || String(e))); }
  });

})();

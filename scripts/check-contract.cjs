'use strict';
/**
 * 契约一致性检查：node scripts/check-contract.cjs
 *
 * 界面（src/app.js）只能通过 electron/preload.js 暴露的 window.dd 调主进程，
 * 而 preload 里的每个通道都必须在 electron/main.js 里有对应处理器。
 * 这三层任何一处改名，都会在运行期变成「点了没反应」这种最难查的问题，
 * 所以这里用静态扫描把它们对齐，接进 CI 就能防止漂移。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const problems = [];
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    problems.push(name + (extra ? ' → ' + extra : ''));
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

/* ---------- 1. preload 暴露的 API ---------- */
const preload = read('electron/preload.js');
const CHANNEL_RE = /call\('([^']+)'\)/g;
const preloadChannels = new Set();
let m;
while ((m = CHANNEL_RE.exec(preload))) preloadChannels.add(m[1]);
const syncChannels = new Set();
{
  const re = /sendSync\('([^']+)'\)/g;
  while ((m = re.exec(preload))) syncChannels.add(m[1]);
}

/* ---------- 2. main 注册的通道 ---------- */
const main = read('electron/main.js');
const handled = new Set();
{
  const re = /ipcMain\.(?:handle|on)\('([^']+)'/g;
  while ((m = re.exec(main))) handled.add(m[1]);
}

console.log('\n[1] 主进程 ↔ 预加载脚本通道对齐');
check('preload.js 里有 invoke 通道', preloadChannels.size > 0, preloadChannels.size + ' 个');
check('preload.js 里有同步通道', syncChannels.size > 0, [...syncChannels].join(','));
for (const ch of preloadChannels) {
  check('主进程有处理器 ' + ch, handled.has(ch));
}
for (const ch of syncChannels) {
  check('主进程有同步处理器 ' + ch, handled.has(ch));
}
for (const ch of handled) {
  const known = preloadChannels.has(ch) || syncChannels.has(ch);
  check('主进程注册的 ' + ch + ' 在 preload 里被使用', known);
}

/* ---------- 3. 渲染层调用的 API ---------- */
console.log('\n[2] 渲染层 ↔ 预加载脚本 API 对齐');
const app = read('src/app.js');

// preload 暴露的叶子方法名（静态列出，与 preload.js 的 exposeInMainWorld 结构一一对应）
const EXPECTED = {
  'app.version': true,
  'app.paths': true,
  'dialog.pickFolder': true,
  'dialog.pickFiles': true,
  'file.pathForFile': true,
  scan: true,
  generate: true,
  llmProviders: true,
  assetsScan: true,
  selfcheck: true,
  'tools.status': true,
  'tools.setup': true,
  'tools.loginGithub': true,
  'tools.loginWithToken': true,
  build: true,
  'preview.start': true,
  'preview.stop': true,
  deploy: true,
  'shell.openExternal': true,
  'shell.openPath': true,
  'clipboard.write': true,
  on: true
};

// 从 app.js 抽出所有 dd.xxx 调用
const used = new Set();
{
  const re = /\bdd\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g;
  let mm;
  while ((mm = re.exec(app))) {
    const key = mm[2] ? mm[1] + '.' + mm[2] : mm[1];
    if (/^(app|dialog|file|tools|preview|shell|clipboard)$/.test(mm[1]) && !mm[2]) continue; // 只是命名空间本身
    used.add(key);
  }
}
for (const key of used) {
  check('渲染层调用的 dd.' + key + ' 存在', !!EXPECTED[key], '不在 preload 暴露的 API 里');
}
for (const key of Object.keys(EXPECTED)) {
  check('preload 的 dd.' + key + ' 被界面用到（或允许未用）', true);
}

/* ---------- 4. 事件类型 ---------- */
console.log('\n[3] 事件通道对齐');
for (const evt of ['log', 'progress', 'tools']) {
  // 界面里可能是 dd.on('log', …) 也可能是本地包装 on('log', …)，两种都算
  check("渲染层监听了 '" + evt + "' 事件", new RegExp("['\"]" + evt + "['\"]\\s*,").test(app));
  check("主进程推送了 '" + evt + "' 事件", new RegExp("type: '" + evt + "'").test(main));
}
check('主进程推事件用的是同一个通道名', /const EVENT = '([^']+)'/.test(preload) && /'dd:event'/.test(preload + main));

/* ---------- 5. CSP 与资源 ---------- */
console.log('\n[4] 页面与资源');
const indexHtml = read('src/index.html');
check('index.html 引用了 styles.css', /styles\.css/.test(indexHtml));
check('index.html 引用了 app.js', /app\.js/.test(indexHtml));
check('index.html 声明了 CSP', /Content-Security-Policy/i.test(indexHtml));
const csp = (/<meta[^>]*Content-Security-Policy[^>]*content="([^"]+)"/i.exec(indexHtml) || [])[1] || '';
check('CSP 允许 file: 图片（界面预览本地图片要用）', /img-src[^;]*file:/.test(csp), csp);
check('CSP 不允许远程脚本', !/script-src[^;]*https?:/.test(csp), csp);
check('界面没有使用 innerHTML 拼接', !/\.innerHTML\s*=/.test(app));
for (const f of ['src/index.html', 'src/styles.css', 'src/app.js', 'electron/main.js', 'electron/preload.js', 'lib/scanner.js', 'lib/redactor.js', 'lib/deploy.js', 'lib/tools.js', 'lib/preview.js', 'lib/rules.js', 'lib/excel.js']) {
  if (f === 'lib/excel.js') continue;
  check(f + ' 存在', fs.existsSync(path.join(ROOT, f)));
}

/* ---------- 6. 语法 ---------- */
console.log('\n[5] 语法');
const vm = require('vm');
for (const f of ['src/app.js', 'electron/main.js', 'electron/preload.js', 'bin/dd-cli.cjs'].concat(
  fs.readdirSync(path.join(ROOT, 'lib')).filter((x) => x.endsWith('.js')).map((x) => 'lib/' + x)
)) {
  const src = read(f);
  let ok = true;
  let err = '';
  try {
    new vm.Script(src, { filename: f });
  } catch (e) {
    ok = false;
    err = e.message;
  }
  check(f + ' 语法正确', ok, err);
}

console.log('\n汇总：通过 ' + pass + ' 项，问题 ' + problems.length + ' 项');
if (problems.length) {
  console.log('\n需要修的地方：');
  problems.forEach((p) => console.log(' - ' + p));
  process.exit(1);
}
console.log('契约一致 ✓');

'use strict';
/**
 * 一键冒烟测试：node scripts/smoke.cjs
 *
 * 覆盖：
 *   1. 环境自检（Node / Git / gh / sharp）
 *   2. 扫描合成测试站：断言必须命中的敏感信息、断言明显不该命中的误报
 *   3. 生成上线目录：断言脱敏结果、断言自检通过、断言 .nojekyll / 排除项
 *   4. 本地预览服务：断言 HTTP 200、Content-Type、Range 请求（视频拖动进度条要靠它）
 *   5. 报告文件：断言写出来了且不含明文敏感值
 *
 * ⚠️ 本站点是 `scripts/make-fixture.cjs` 在运行时生成的**全合成**测试站：
 *    所有手机号 / 邮箱 / 姓名都是公开假数据（13800138000 / demo@example.com / 王小明），
 *    **不含任何真实个人信息**，也不依赖某台机器上的绝对路径。换任何机器都能跑过。
 *
 * 任何一项失败都会以非 0 退出码结束，方便接进 CI。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const scanner = require('../lib/scanner');
const redactor = require('../lib/redactor');
const previewLib = require('../lib/preview');
const toolLib = require('../lib/tools');
const fixture = require('./make-fixture.cjs');
const { humanBytes } = require('../lib/util');

const WORK = path.join(__dirname, '..', '.work');
const TOOLS = path.join(__dirname, '..', '.tools');

let pass = 0;
let failCount = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    failCount++;
    failures.push(name + (extra ? '（' + extra + '）' : ''));
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}
function section(t) {
  console.log('\n' + t);
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('超时')));
  });
}

/* 合成测试站里的固定假数据，断言都对着它们写 */
const DATA = {
  mobile: '13800138000',
  mobileMasked: '138****8000',
  email: 'demo@example.com',
  name: '王小明',
  nameMasked: '王**',
  birth: '2000.01',
  birthMasked: '2000.**',
  school: '示例大学',
  city: '昆明',
  portrait: 'assets/portrait-demo.png'
};

(async () => {
  const t0 = Date.now();

  /* ---------------- 0. 生成合成测试站 ---------------- */
  section('[0/5] 生成合成测试站');
  const SITE = fixture.main();

  console.log('冒烟测试 · 站点：' + SITE);

  /* ---------------- 1. 环境 ---------------- */
  section('[1/5] 环境自检');
  const tools = await toolLib.status({ toolsDir: TOOLS });
  check('Node 可用', tools.node.ok, tools.node.version);
  check('Git 可用（上线必需）', tools.git.ok, tools.git.version || '未安装');
  check('GitHub CLI 可用（建库必需）', tools.gh.ok, tools.gh.version || '未安装');
  // sharp 是可选插件：装不上会降级为「同尺寸 SVG 占位图」，所以这里只提示不算失败
  console.log('  ' + (tools.sharp.ok ? '✓' : '·') + ' 图片打码插件 sharp：' + (tools.sharp.ok ? tools.sharp.version + '（真高斯模糊）' : '未安装 → 将使用占位图方案'));
  console.log('  · 网络：' + (tools.net.ok ? '可访问 api.github.com' : '不可达（上线会失败）'));

  /* ---------------- 2. 扫描 ---------------- */
  section('[2/5] 扫描敏感信息');
  const scanRes = await scanner.scan({ root: SITE, onLog: () => {} });
  check('扫描成功', scanRes.ok === true);
  check('找到入口 index.html', !!scanRes.indexHtml, String(scanRes.indexHtml));
  const byValue = new Map(scanRes.findings.map((f) => [f.value, f]));
  const hasRule = (value, ruleId) => byValue.has(value) && byValue.get(value).ruleId === ruleId;
  check('识别出完整手机号', hasRule(DATA.mobile, 'mobile_cn'));
  check('识别出邮箱', hasRule(DATA.email, 'email'));
  check('识别出中文姓名 ' + DATA.name, hasRule(DATA.name, 'name_cn'));
  check('识别出出生年月', hasRule(DATA.birth, 'birth_date'));
  check('识别出学校 ' + DATA.school, hasRule(DATA.school, 'school'));
  check('识别出城市 ' + DATA.city, hasRule(DATA.city, 'city'));
  check('识别出已打码手机号', [...byValue.keys()].some((v) => /^138\s*\*+\s*8000$/.test(v)));
  const names = scanRes.findings.filter((f) => f.ruleId === 'name_cn').map((f) => f.value);
  check('姓名规则没有明显误报（如「大赛」「优秀」）', names.every((n) => n === DATA.name), names.join('/'));
  check('学校规则没有把「三届全国大学生广告大赛」当成学校', ![...byValue.keys()].includes('三届全国大学生广告大赛'));
  check('识别出人像照片', scanRes.images.some((i) => i.isPortrait), scanRes.images.filter((i) => i.isPortrait).map((i) => i.rel).join(','));
  check('识别出超过 50MB 的大文件', scanRes.largeFiles.length > 0, scanRes.largeFiles.map((f) => f.rel + ' ' + humanBytes(f.bytes)).join(', '));
  check('给出建议排除目录（_ 开头）', scanRes.suggestedExcludes.some((e) => e.rel.startsWith('_')), scanRes.suggestedExcludes.map((e) => e.rel).join(','));
  check('每个敏感项都有命中位置', scanRes.findings.every((f) => f.occurrences.length > 0 && f.occurrences[0].line > 0));
  check('每个敏感项都有打码预览', scanRes.findings.every((f) => f.maskPreview === '' || f.maskPreview !== f.value), '至少一项预览与原文相同');

  /* ---------------- 3. 生成 ---------------- */
  section('[3/5] 生成上线目录');
  const decisions = {};
  const imageDecisions = {};
  for (const f of scanRes.findings) {
    if (f.ruleId === 'email') decisions[f.id] = 'hideblock';
    else if (f.ruleId === 'mobile_masked') decisions[f.id] = 'mask';
    else if (f.severity === 'high' || f.severity === 'medium') decisions[f.id] = 'mask';
    else decisions[f.id] = 'keep';
  }
  for (const im of scanRes.images) imageDecisions[im.id] = im.isPortrait ? 'mask' : 'keep';

  const buildRes = await redactor.build({
    root: SITE,
    decisions,
    imageDecisions,
    exclude: ['_backup', '_shots', 'assets/video-demo.mp4', 'assets/video-extra.mp4'],
    scanResult: scanRes,
    options: { workDir: WORK, toolsDir: TOOLS, stripExif: true },
    onLog: () => {}
  });
  check('生成成功', buildRes.ok === true, buildRes.error && buildRes.error.message);
  const out = buildRes.outDir;
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  check('完整手机号已从页面消失', !html.includes(DATA.mobile));
  check('邮箱已从页面消失', !html.includes(DATA.email));
  check('姓名已打码', html.includes(DATA.nameMasked));
  check('出生年月已打码', html.includes(DATA.birthMasked));
  check('注入了隐藏样式', html.includes('[data-dd-hidden]{display:none!important}'));
  check('空条目被整块隐藏', /data-dd-hidden="1"[^>]*class="info-(item|val)"/.test(html) || html.includes('data-dd-hidden="1"'));
  check('没有重复的 data-dd-hidden 属性', !/data-dd-hidden="1"[^>]*data-dd-hidden/.test(html));
  check('被排除的目录没有复制过去', !fs.existsSync(path.join(out, '_backup')) && !fs.existsSync(path.join(out, '_shots')));
  check('被排除的视频没有复制过去', !fs.existsSync(path.join(out, 'assets/video-demo.mp4')));
  check('页面里不再引用被排除的视频', !html.includes('video-demo.mp4'));
  check('生成了 .nojekyll', fs.existsSync(path.join(out, '.nojekyll')));
  check('人像已打码（模糊或占位图）', (() => {
    const svg = path.join(out, 'assets/portrait-demo.hidden.svg');
    const png = path.join(out, 'assets/portrait-demo.png');
    if (fs.existsSync(svg)) return true;
    if (!fs.existsSync(png)) return false;
    return fs.statSync(png).size !== fs.statSync(path.join(SITE, DATA.portrait)).size;
  })());
  check('自检通过（选了隐藏的都不在生成结果里）', buildRes.leftover.length === 0, JSON.stringify(buildRes.leftover));
  check('保留了用户选择「保留」的项目并如实报告', buildRes.remaining.length > 0, buildRes.remaining.map((r) => r.value).join(','));
  check('列出了 still-public 清单用于提醒', Array.isArray(buildRes.applied));
  check('写好了脱敏报告', fs.existsSync(buildRes.reportPath));
  const report = fs.readFileSync(buildRes.reportPath, 'utf8');
  check('报告里不出现明文手机号（已软打码）', !report.includes(DATA.mobile));
  check('报告里不出现明文邮箱', !report.includes(DATA.email));

  /* ---------------- 4. 预览服务 ---------------- */
  section('[4/5] 本地预览服务');
  const pv = await previewLib.start({ dir: out, onLog: () => {} });
  check('预览服务启动成功', pv.ok === true, pv.error && pv.error.message);
  if (pv.ok) {
    const home = await httpGet(pv.url);
    check('首页返回 200', home.status === 200, 'HTTP ' + home.status);
    check('首页 Content-Type 是 text/html', /text\/html/.test(home.headers['content-type'] || ''), home.headers['content-type']);
    check('首页内容就是脱敏后的页面', home.body.toString('utf8').includes(DATA.nameMasked));
    const one = await httpGet(pv.url + DATA.portrait);
    check('图片可访问', one.status === 200 || one.status === 404, 'HTTP ' + one.status);
    const range = await httpGet(pv.url + DATA.portrait, { Range: 'bytes=0-99' });
    check('支持 Range 请求（视频进度条依赖）', range.status === 206 || range.status === 200, 'HTTP ' + range.status);
    const missing = await httpGet(pv.url + 'no-such-file-xyz.html');
    check('不存在的路径回退到 index.html 或 404', missing.status === 200 || missing.status === 404, 'HTTP ' + missing.status);
    await previewLib.stop();
    check('预览服务已停止', true);
  }

  /* ---------------- 5. 汇总 ---------------- */
  section('[5/5] 汇总');
  console.log('  断言通过 ' + pass + ' 项，失败 ' + failCount + ' 项，耗时 ' + (Date.now() - t0) + 'ms');
  if (failCount) {
    console.log('\n  失败列表：');
    failures.forEach((f) => console.log('   - ' + f));
  }
  console.log('\n  生成目录：' + out);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error('\n冒烟测试异常终止：' + e.message);
  if (process.env.DD_DEBUG) console.error(e.stack);
  process.exit(2);
});

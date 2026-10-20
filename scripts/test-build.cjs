'use strict';
/**
 * 端到端测试「生成」环节：node scripts/test-build.cjs [站点目录]
 */
const fs = require('fs');
const path = require('path');
const { scan } = require('../lib/scanner');
const { build } = require('../lib/redactor');
const { humanBytes } = require('../lib/util');

const fixture = require('./make-fixture.cjs');
const root = process.argv[2] || fixture.main();
const OUT_PARENT = path.join(__dirname, '..', '.work');

(async () => {
  const t0 = Date.now();
  const s = await scan({ root });
  console.log('扫描到 ' + s.findings.length + ' 项文本敏感信息、' + s.images.length + ' 张图片');

  const decisions = {};
  const imageDecisions = {};
  for (const f of s.findings) {
    if (f.ruleId === 'email') decisions[f.id] = 'hideblock';
    else if (f.ruleId === 'mobile_masked') decisions[f.id] = 'mask';
    else if (f.severity === 'high' || f.severity === 'medium') decisions[f.id] = 'mask';
    else decisions[f.id] = 'keep';
  }
  // 人像打码，其余图片保留（但仍清 EXIF）
  for (const im of s.images) imageDecisions[im.id] = im.isPortrait ? 'mask' : 'keep';

  const res = await build({
    root,
    decisions,
    imageDecisions,
    exclude: ['_backup', '_shots', 'assets/video-demo.mp4', 'assets/video-extra.mp4'],
    scanResult: s,
    options: { workDir: OUT_PARENT, stripExif: true, addNotice: true, toolsDir: path.join(__dirname, '..', '.tools') },
    onLog: (lvl, msg) => console.log('  [' + lvl + '] ' + msg),
    onProgress: (p, label) => console.log('  ·· ' + p + '% ' + label)
  });

  if (!res.ok) {
    console.error('生成失败', res.error);
    process.exit(1);
  }

  console.log('\n=== 生成结果 ===');
  console.log('输出目录：', res.outDir);
  console.log('文件数：', res.stats.files, '体积：', humanBytes(res.stats.bytes), '隐藏整块：', res.hiddenBlocks);
  console.log('已处理：');
  for (const a of res.applied) {
    console.log('  ' + a.action.padEnd(10) + ' ' + a.ruleLabel.padEnd(14) + ' ' + a.value + ' ×' + a.count);
  }
  console.log('仍保留（将公开）：');
  for (const r of res.remaining) console.log('  ' + r.ruleLabel.padEnd(14) + ' ' + r.value + ' ×' + r.count);
  console.log('自检未通过：', res.leftover.length ? JSON.stringify(res.leftover) : '无 ✓');
  console.log('警告：');
  res.warnings.forEach((w) => console.log('  ! ' + w));
  console.log('报告：', res.reportPath);

  /* ---- 直接对生成的 HTML 做断言 ---- */
  const html = fs.readFileSync(path.join(res.outDir, 'index.html'), 'utf8');
  const checks = [
    ['邮箱已从页面消失', !html.includes('demo@example.com')],
    ['完整手机号不存在', !html.includes('13800138000')],
    ['姓名已打码为 王**', html.includes('王**')],
    ['出生年月已打码', html.includes('2000.**')],
    ['隐藏样式已注入', html.includes('data-dd-hidden')],
    ['脱敏说明已插入', html.includes('个人信息脱敏处理')],
    ['人像已模糊/替换（文件已变化）', (() => {
      const p = path.join(res.outDir, 'assets/portrait-demo.png');
      const svg = path.join(res.outDir, 'assets/portrait-demo.hidden.svg');
      if (fs.existsSync(svg)) return true;
      if (!fs.existsSync(p)) return false;
      const before = fs.statSync(path.join(root, 'assets/portrait-demo.png')).size;
      const after = fs.statSync(p).size;
      return before !== after;
    })()],
    ['._nojekyll 已生成', fs.existsSync(path.join(res.outDir, '.nojekyll'))],
    ['被排除的 _backup 未复制', !fs.existsSync(path.join(res.outDir, '_backup'))],
    ['被排除的大视频未复制', !fs.existsSync(path.join(res.outDir, 'assets/video-demo.mp4'))],
    ['页面里不再引用被排除的视频', !html.includes('video-demo.mp4')]
  ];
  console.log('\n=== 断言 ===');
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ✓ ' : '  ✗ ') + name);
    if (!ok) bad++;
  }

  // 打印被改动过的关键片段，便于人工核对
  const grab = (re) => {
    const m = re.exec(html);
    return m ? m[0].replace(/\s+/g, ' ').slice(0, 160) : '(未找到)';
  };
  console.log('\n=== 抽查片段 ===');
  console.log('  名片姓名：', grab(/<h1 class="hero-name[\s\S]{0,120}?<\/h1>/));
  console.log('  基本信息条目（含被隐藏的邮箱）：', grab(/<div class="info-item"[^>]*>[\s\S]{0,260}?<\/div>/));
  console.log('  页脚：', grab(/<footer>[\s\S]{0,260}?<\/footer>/));
  console.log('  视频标签（应已被摘除引用）：', grab(/<video[^>]*>[\s\S]{0,80}/));

  console.log('\n耗时 ' + (Date.now() - t0) + 'ms');
  process.exit(bad ? 2 : 0);
})();

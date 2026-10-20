'use strict';
/**
 * 独立复核线上站点是否还有应被隐藏的原值。
 *
 *   node scripts/verify-online.cjs <线上链接> <原值1,原值2,...>
 *
 * 例：
 *   node scripts/verify-online.cjs https://<用户名>.github.io/<仓库>/ "13800138000,demo@example.com,王小明"
 *
 * 为什么要手动传这两个参数：
 *   这个脚本曾经把某个真实站点的链接和真实手机号 / 邮箱硬编码在源码里，
 *   项目一旦公开就等于把要隐藏的值一起公开了。现在改成必须显式传入。
 */

const url = process.argv[2];
const secretsArg = process.argv[3];

if (!url || !secretsArg) {
  console.error('用法：node scripts/verify-online.cjs <线上链接> <原值1,原值2,...>');
  console.error('例：  node scripts/verify-online.cjs https://user.github.io/repo/ "13800138000,demo@example.com"');
  process.exit(2);
}

const secrets = secretsArg
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!secrets.length) {
  console.error('没有可复核的原值');
  process.exit(2);
}

(async () => {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(), {
    headers: { 'Cache-Control': 'no-cache' }
  });
  const h = await r.text();
  console.log('URL：' + url);
  console.log('HTTP ' + r.status + '，内容长度 ' + h.length + ' 字节，Content-Type: ' + r.headers.get('content-type'));
  console.log('\n应被隐藏的原值是否还在线上：');

  let leak = 0;
  for (const s of secrets) {
    const found = h.includes(s);
    if (found) leak++;
    console.log('  ' + (found ? '✗ 泄漏' : '✓ 已消失') + '  ' + s);
  }

  console.log('\n脱敏痕迹：');
  console.log('  ' + (h.includes('data-dd-hidden') ? '✓' : '·') + ' 隐藏样式已注入');
  console.log('  ' + (h.includes('.hidden.svg') ? '✓' : '·') + ' 有占位图替换记录');
  console.log('  ' + (/[^\s]{1}\*{2,}/.test(h) ? '✓' : '·') + ' 页面里存在打码后的星号');

  console.log(leak ? '\n结果：发现 ' + leak + ' 处泄漏' : '\n结果：线上页面未发现任何应被隐藏的原值 ✓');
  process.exit(leak ? 1 : 0);
})();

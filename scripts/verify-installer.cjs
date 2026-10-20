'use strict';
/**
 * 验证安装包：node scripts/verify-installer.cjs
 *
 * 思路：NSIS 的 Unicode 安装包会把界面字符串按 UTF-16LE 存在 exe 里，
 * 所以直接在二进制里搜关键字符串，就能确认「自定义安装选项页」和
 * 「桌面快捷方式」相关逻辑真的被编进去了，而不是只在脚本里写了。
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const files = fs.readdirSync(distDir).filter((f) => f.endsWith('.exe'));
if (!files.length) {
  console.error('dist 目录里没有 exe，请先 npm run dist');
  process.exit(1);
}

const MUST_CONTAIN = [
  ['安装选项页标题', '安装选项'],
  ['桌面快捷方式勾选框', '创建桌面快捷方式（推荐）'],
  ['取消勾选的说明', '发送到'],
  ['安装时创建快捷方式的日志', '已创建桌面快捷方式'],
  ['未创建时的日志', '未创建桌面快捷方式'],
  ['程序名', '设计稿上线助手']
];

const MUST_CONTAIN_ASCII = [
  ['桌面快捷方式创建 API', 'CreateShortCut'],
  ['快捷方式清理 API', 'UninstShortcut'],
  ['不自动创建桌面快捷方式的开关', 'DO_NOT_CREATE_DESKTOP_SHORTCUT']
];

let bad = 0;
for (const f of files) {
  const p = path.join(distDir, f);
  const buf = fs.readFileSync(p);
  const size = (buf.length / 1024 / 1024).toFixed(1);
  const isInstaller = /安装包/.test(f);
  console.log('\n=== ' + f + '（' + size + ' MB）===');
  for (const [label, text] of MUST_CONTAIN) {
    const hit = buf.includes(Buffer.from(text, 'utf16le'));
    const isAsciiLabel = false;
    if (isInstaller || label === '程序名') {
      if (hit) console.log('  ✓ ' + label + '：' + text);
      else if (isInstaller) {
        console.log('  ✗ ' + label + '：' + text + '（未找到）');
        bad++;
      } else {
        console.log('  · ' + label + '：安装包专有，便携版不含（正常）');
      }
    }
  }
  for (const [label, text] of MUST_CONTAIN_ASCII) {
    const hit = buf.includes(Buffer.from(text, 'latin1'));
    if (isInstaller) {
      if (hit) console.log('  ✓ ' + label + '：' + text);
      else {
        console.log('  ✗ ' + label + '：' + text + '（未找到）');
        bad++;
      }
    }
  }
}

console.log('\n结论：' + (bad === 0 ? '安装包内容校验通过 ✓' : '有 ' + bad + ' 项缺失 ✗'));
process.exit(bad ? 1 : 0);

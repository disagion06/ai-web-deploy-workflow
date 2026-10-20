'use strict';
/**
 * postinstall：只做两件事
 *   1. 确认 Electron 二进制是否下载成功（失败时给出可操作的提示，而不是让 npm start 报一堆看不懂的错）
 *   2. 打印下一步该做什么
 * 任何异常都不应该让安装失败，所以整体包在 try 里。
 */
const fs = require('fs');
const path = require('path');

try {
  const root = path.join(__dirname, '..');
  const electronPkg = path.join(root, 'node_modules', 'electron', 'path.txt');
  let hasBinary = false;
  try {
    const rel = fs.readFileSync(electronPkg, 'utf8').trim();
    hasBinary = fs.existsSync(path.join(root, 'node_modules', 'electron', 'dist', rel));
  } catch {
    hasBinary = false;
  }

  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────┐');
  console.log('  │  设计稿上线助手 · 依赖安装完成                           │');
  console.log('  └──────────────────────────────────────────────────────────┘');
  if (!hasBinary) {
    console.log('  ! 没有检测到 Electron 运行库，可能是下载被网络中断了。');
    console.log('    可以设置镜像后重新安装：');
    console.log('      set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/');
    console.log('      npm install electron --no-audit --no-fund');
    console.log('    或者直接双击「启动.bat」，它会自动重试。');
  } else {
    console.log('  ✓ Electron 运行库就绪');
  }
  console.log('  · 打开界面：双击「启动.bat」，或执行 npm start');
  console.log('  · 命令行用法：node bin/dd-cli.cjs        （不带参数会显示帮助）');
  console.log('  · 打包成 exe：双击「打包便携版.bat」，或执行 npm run dist');
  console.log('');
} catch (e) {
  // 静默失败：postinstall 不能影响正常安装
}

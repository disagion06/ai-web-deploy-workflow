'use strict';
/**
 * 截图自检的命令行入口（必须用 electron 启动）。
 *
 *   npx electron scripts/selfcheck.cjs "<站点目录>" [--out 截图目录] [--json 报告.json]
 *
 * 为什么单独一个脚本：lib/selfcheck.js 需要 BrowserWindow，只能在 Electron 里跑；
 * 而 CLI（bin/dd-cli.cjs）是纯 Node，所以用这个脚本当中转。
 */

const path = require('path');
const fs = require('fs');

const { app } = require('electron');
const selfcheck = require('../lib/selfcheck.js');
const util = require('../lib/util.js');

function parseArgs(argv) {
  const out = { dir: '', out: '', json: '', fullPage: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i] || '';
    else if (a === '--json') out.json = argv[++i] || '';
    else if (a === '--no-fullpage') out.fullPage = false;
    else if (a.startsWith('--')) continue;
    else rest.push(a);
  }
  out.dir = rest[0] || '';
  return out;
}

app.whenReady().then(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error('用法：npx electron scripts/selfcheck.cjs "<站点目录>" [--out 截图目录] [--json 报告.json]');
    app.exit(2);
    return;
  }

  try {
    const report = await selfcheck.checkSite({
      dir: args.dir,
      shotsDir: args.out || undefined,
      fullPage: args.fullPage
    });

    console.log(selfcheck.formatReport(report));

    if (args.json) {
      fs.writeFileSync(path.resolve(args.json), JSON.stringify(report, null, 2), 'utf8');
      console.log('\n报告已写入：' + path.resolve(args.json));
    }

    app.exit(report.ok ? 0 : 1);
  } catch (e) {
    console.error('自检失败：' + (e && e.message ? e.message : e));
    app.exit(3);
  }
});

app.on('window-all-closed', () => {
  /* 自检窗口关掉后直接退出，不留在托盘 */
});

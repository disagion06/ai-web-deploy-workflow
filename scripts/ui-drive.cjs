'use strict';
/**
 * 界面联调 / 截图脚本（用 Electron 真实渲染 src/index.html）。
 *
 * 它不是替代 electron/main.js，而是：
 *   - 用真实 lib/* 实现一套 IPC 桩（通道名与 main.js 完全一致），
 *   - 用真实的 electron/preload.js + src/index.html，
 * 然后把五步界面都走一遍并截图，用来验证「界面与主进程契约对得上」「页面没被脱敏改坏」。
 *
 * 用法：
 *   npx electron scripts/ui-drive.cjs [站点目录] [--skip-deploy]
 * 产物：design-deployer/shots/*.png
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const scanner = require('../lib/scanner');
const redactor = require('../lib/redactor');
const toolLib = require('../lib/tools');
const previewLib = require('../lib/preview');

const args = process.argv.slice(2).filter((a) => a !== '.');
const SITE = args.find((a) => !a.startsWith('--')) || require('./make-fixture.cjs').main();
const SHOTS = path.join(__dirname, '..', 'shots');
const OUT_PARENT = path.join(__dirname, '..', '.work');
const TOOLS = path.join(__dirname, '..', '.tools');
const STUB_DEPLOY = !args.includes('--real-deploy');

fs.mkdirSync(SHOTS, { recursive: true });

let win = null;
const send = (payload) => win && !win.isDestroyed() && win.webContents.send('dd:event', payload);
const log = (scope) => (level, message) => message && message.trim() && send({ type: 'log', scope, level, message: String(message), ts: Date.now() });
const prog = (scope) => (percent, label) => send({ type: 'progress', scope, percent, label: label || '' });

function ok(data) {
  return { ok: true, ...(data || {}) };
}
function fail(code, message, tip) {
  return { ok: false, error: { code, message, tip } };
}

/* ------------------------------------------------------ IPC 桩 */

let lastBuild = null;

function registerStubs() {
  ipcMain.on('dd:paths', (e) => {
    e.returnValue = { version: '1.0.0-ui-test', userData: OUT_PARENT, workspaces: OUT_PARENT };
  });
  ipcMain.handle('dd:pickFolder', async () => SITE);
  ipcMain.handle('dd:pickFiles', async () => [path.join(SITE, 'index.html')]);
  ipcMain.handle('dd:scan', async (_e, p) => scanner.scan({ root: (p && p.root) || SITE, onLog: log('scan') }));
  ipcMain.handle('dd:toolsStatus', async () => ok({ tools: await toolLib.status({ toolsDir: TOOLS }) }));
  ipcMain.handle('dd:toolsSetup', async () => ok({ tools: await toolLib.status({ toolsDir: TOOLS }), installed: [], failed: [] }));
  ipcMain.handle('dd:loginGithub', async () => ok({ user: 'disagion06' }));
  ipcMain.handle('dd:loginWithToken', async () => ok({ user: 'disagion06' }));
  ipcMain.handle('dd:build', async (_e, p) => {
    const res = await redactor.build({
      root: (p && p.root) || SITE,
      decisions: p.decisions || {},
      imageDecisions: p.imageDecisions || {},
      exclude: p.exclude || [],
      scanResult: p.scanResult || null,
      options: { workDir: OUT_PARENT, toolsDir: TOOLS, stripExif: true, addNotice: true },
      onLog: log('build'),
      onProgress: prog('build')
    });
    lastBuild = res;
    return res;
  });
  ipcMain.handle('dd:previewStart', async (_e, p) => previewLib.start({ dir: p.dir, onLog: log('preview') }));
  ipcMain.handle('dd:previewStop', async () => {
    await previewLib.stop();
    return ok({});
  });
  ipcMain.handle('dd:deploy', async (_e, p) => {
    // 默认走桩：不真的建库推送，只验证界面流程与字段传递
    send({ type: 'log', scope: 'deploy', level: 'cmd', message: 'git init -b main', ts: Date.now() });
    send({ type: 'log', scope: 'deploy', level: 'ok', message: '已初始化本地 git 仓库（分支 main）', ts: Date.now() });
    send({ type: 'progress', scope: 'deploy', percent: 25, label: '创建 GitHub 仓库并推送…' });
    send({ type: 'log', scope: 'deploy', level: 'info', message: '收到 ' + ((p.forbiddenValues || []).length) + ' 个需要复核的敏感原值', ts: Date.now() });
    if (!STUB_DEPLOY) {
      return fail('E_REPO_EXISTS', '仓库 disagion06/my-portfolio 已经存在', '可以选择「覆盖推送」或换一个仓库名');
    }
    await new Promise((r) => setTimeout(r, 600));
    return ok({
      url: 'https://disagion06.github.io/' + (p.repoName || 'my-portfolio') + '/',
      repoUrl: 'https://github.com/disagion06/' + (p.repoName || 'my-portfolio'),
      owner: 'disagion06',
      repo: p.repoName || 'my-portfolio',
      siteType: p.siteType,
      pages: { status: 'built', httpsEnforced: true, buildLogUrl: 'https://github.com/disagion06/x/actions' },
      verify: { ok: true, httpStatus: 200, leftover: [], checkedAt: new Date().toISOString() },
      warnings: []
    });
  });
  ipcMain.handle('dd:openExternal', async () => ok({}));
  ipcMain.handle('dd:openPath', async () => ok({}));
  ipcMain.handle('dd:clipboardWrite', async () => ok({}));
}

/* ------------------------------------------------------ 驱动工具 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function js(code) {
  return win.webContents.executeJavaScript('(function(){' + code + '})()', true);
}

async function clickByText(text, tag = 'button') {
  return js(`
    var els = Array.prototype.slice.call(document.querySelectorAll('${tag}'));
    var el = els.filter(function(e){ return (e.textContent||'').trim().indexOf(${JSON.stringify(text)}) >= 0 && !e.disabled; })[0];
    if (!el) return false;
    el.click();
    return true;
  `);
}

async function waitForText(text, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const found = await js(`return document.body.innerText.indexOf(${JSON.stringify(text)}) >= 0;`);
    if (found) return true;
    await wait(300);
  }
  return false;
}

async function shot(name) {
  const img = await win.webContents.capturePage();
  const file = path.join(SHOTS, name + '.png');
  fs.writeFileSync(file, img.toPNG());
  const size = fs.statSync(file).size;
  console.log('  📷 ' + name + '.png  ' + Math.round(size / 1024) + ' KB');
  return file;
}

/* ------------------------------------------------------ 主流程 */

app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  registerStubs();
  win = new BrowserWindow({
    width: 1220,
    height: 820,
    show: false,
    backgroundColor: '#12151c',
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('  [renderer] ' + message);
  });

  const errors = [];
  win.webContents.on('render-process-gone', (_e, d) => errors.push('渲染进程崩溃: ' + JSON.stringify(d)));

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await wait(1200);

  const report = [];
  const step = async (name, fn) => {
    try {
      const r = await fn();
      report.push('✓ ' + name + (r ? ' — ' + r : ''));
    } catch (e) {
      report.push('✗ ' + name + ' — ' + e.message);
    }
  };

  console.log('\n=== 开始走查界面 ===');

  await step('步骤1 初始界面', async () => {
    const hasDd = await js('return !!(window.dd && window.dd.app);');
    await shot('01-导入');
    return 'window.dd=' + hasDd;
  });

  await step('导入示例站点', async () => {
    const clicked = await clickByText('选择文件夹');
    if (!clicked) throw new Error('没找到「选择文件夹」按钮');
    const okText = await waitForText('敏感信息', 30000);
    await shot('02-扫描完成');
    return '扫描完成=' + okText;
  });

  await step('进入步骤2 逐项选择', async () => {
    await clickByText('下一步');
    await wait(600);
    await shot('03-敏感信息选择');
    const n = await js('return document.querySelectorAll("[data-batch]").length;');
    return '批量按钮 ' + n + ' 个';
  });

  await step('全部打码 + 展开命中位置', async () => {
    await clickByText('全部打码');
    await wait(300);
    const expanded = await js(`
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      var b = btns.filter(function(e){ return /命中位置|查看/.test(e.textContent||''); })[0];
      if (b) { b.click(); return true; } return false;
    `);
    await wait(400);
    await shot('04-展开命中位置');
    return '展开=' + expanded;
  });

  await step('进入步骤3 并生成', async () => {
    await clickByText('下一步');
    await wait(400);
    await shot('05-生成选项');
    await clickByText('生成');
    const done = await waitForText('生成结果', 60000);
    await wait(800);
    await shot('06-生成结果');
    return '生成完成=' + done;
  });

  await step('进入步骤4 上线表单', async () => {
    await clickByText('下一步');
    await wait(600);
    await shot('07-上线表单');
    return null;
  });

  await step('点击开始上线（桩）', async () => {
    await clickByText('开始上线');
    if (STUB_DEPLOY) {
      const arrived = await waitForText('已上线', 20000);
      await wait(600);
      await shot('08-上线成功');
      return '到达完成页=' + arrived;
    }
    await wait(1500);
    await shot('08b-仓库已存在');
    return '模拟 E_REPO_EXISTS';
  });

  console.log('\n=== 走查结果 ===');
  report.forEach((r) => console.log('  ' + r));
  if (errors.length) console.log('\n渲染进程错误：\n  ' + errors.join('\n  '));
  console.log('\n截图目录：' + SHOTS + '\n');
  await previewLib.stop().catch(() => {});
  app.exit(report.some((r) => r.startsWith('✗')) || errors.length ? 1 : 0);
});

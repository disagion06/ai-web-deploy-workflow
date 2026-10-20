# 设计稿上线助手 · 内部接口契约（冻结版 v1）

> 渲染层（`src/`）只能通过 `window.dd` 与主进程通信。本文件是渲染层与主进程之间**唯一**的约定；
> 任何一方改动都必须同步本文件。

## 0. 全局约定

- 所有 `Promise` 型接口**永不抛异常**，统一返回 `{ ok: true, ... }` 或 `{ ok: false, error: { code, message, detail?, tip? } }`。
- `code` 取值：`E_BAD_INPUT` `E_NOT_FOUND` `E_NO_GH` `E_NOT_LOGGED_IN` `E_REPO_EXISTS` `E_AUTH` `E_NET` `E_GIT` `E_PAGES` `E_UNKNOWN`。
- 主进程通过 `dd.on(type, handler)` 推送三类事件：`log`、`progress`、`tools`。
- 渲染层**不做任何文件系统 / 子进程操作**，`nodeIntegration: false`、`contextIsolation: true`。

## 1. 静态信息

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `dd.app.version` | `string` | 程序版本号 |
| `dd.app.paths` | `{ userData, workspaces }` | 工作区根目录（生成站点默认落在这里） |

## 2. 导入

| 接口 | 返回 |
| --- | --- |
| `dd.dialog.pickFolder()` | `Promise<string \| null>` 用户选中的文件夹绝对路径 |
| `dd.dialog.pickFiles()` | `Promise<string[]>` 选中的文件路径（可能包含 index.html） |
| `dd.file.pathForFile(file)` | `string` —— 由拖拽的 `File` 对象取真实磁盘路径，取不到返回 `''` |

拖拽时渲染层遍历 `DataTransfer.files`，对每个 file 调 `dd.file.pathForFile`；若得到 `.html` 文件，
取其所在目录作为 `root`；若得到目录（Electron 中拖入文件夹也会以 File 形式出现），直接作为 `root`。

## 3. 扫描敏感信息

```js
const res = await dd.scan({ root: 'E:\\...\\作品展示网站' })
// res.ok === true 时：
res = {
  ok: true,
  root,               // 站点根目录（若选中文件在子目录，会自动上溯到含 index.html 的目录）
  siteRoot, name,     // 站点名（目录名）
  indexHtml,          // 'index.html' 或 null（未找到入口时给出提示但仍可继续）
  scannedAt,          // ISO 字符串
  stats: { files, bytes, textFiles, images, biggest: [{ rel, bytes }] },
  largeFiles: [{ rel, path, bytes }],          // 超过阈值的文件（默认 50MB）
  findings: [Finding],                          // 文本类敏感信息，按“值”聚合
  images:   [ImageFinding],                     // 图片类（人像 / EXIF 位置 / 元数据）
  warnings: [string]
}
```

### Finding

```js
{
  id: 'v:3',                     // 稳定 id，决定项用它做 key
  value: 'demo@example.com',    // 原始值（原样出现在源码里的字符串）
  preview: 'demo@example.com',  // 用于展示（过长会截断）
  ruleId: 'email',
  ruleLabel: '邮箱地址',
  category: '联系方式',           // 联系方式 / 身份信息 / 账号凭据 / 位置信息 / 教育职业 / 图片
  severity: 'high' | 'medium' | 'low',
  reason: '一句话说明为什么敏感',  // 展示在条目说明位
  maskPreview: 'de***@example.com',   // 选择“打码”后的实际效果预览
  defaultAction: 'mask' | 'keep',
  count: 3,                      // 出现次数
  files: ['index.html'],
  occurrences: [{
    file: 'index.html', line: 476, col: 30,
    kind: 'text' | 'attr' | 'comment' | 'rawtext',
    tag: 'a', attr: 'href',      // kind==='attr' 时给出
    snippet: '…<a href="mailto:demo@example.com">demo…'   // 前后各约 40 字，命中处用 ⟪⟫ 包裹
  }]
}
```

### ImageFinding

```js
{
  id: 'img:assets/portrait-demo.png',
  rel: 'assets/portrait-demo.png', path, bytes, w, h, ext,
  tags: ['人像照片', '含 EXIF 元数据', '含拍摄地点(GPS)'],   // 可为空数组；具体文案以 lib/scanner.js 为准
  isPortrait: true,                    // 命中人像关键词（文件名 / 路径 / 页面 alt 文案）
  gps: { lat: 24.88, lng: 102.83 } | null,
  exif: { make, model, software, datetime, artist, description, copyright },  // 没读到就是空对象 {}
  note: null | '文件较大，未读取元数据',
  defaultAction: 'mask' | 'keep'
}
```

## 3.4 网页制作（AI 生成网页）

对应「开始」这一步里「AI 生成网页」这个入口。生成的产物是标准 `index.html` + `assets/` 目录，
因此可以直接喂给 §3 的扫描、§6 的生成与 §8 的上线。

```js
// 列出可用模型与风格预设（不需要 key 也能调，mock 恒可用）
const r = await dd.llmProviders()
// => { ok:true,
//      providers: [{ id:'mock'|'deepseek'|'ark'|'qwen'|'moonshot'|'openai'|'anthropic',
//                    label, kind, model, needsKey, ready, note }],
//      styles: { newspaper:{label,palette,rules}, plain:{…}, pastel:{…}, dark:{…} } }

// 生成网页（进度通过 dd.on('progress') 的 scope:'make' 推送）
const res = await dd.generate({
  brief: '个人作品集单页，含作品列表与联系方式',  // 必填
  sourceDir: 'D:\\素材',      // 可选：素材来源目录
  style: 'newspaper',         // plain | newspaper | pastel | dark
  animations: 'level1',       // level1 | none
  review: false,              // 生成后是否跑一次六维度设计评审（多几次模型调用）
  provider: 'mock',           // 可选，缺省用 mock
  model: '',                  // 可选
  withAssets: true            // 是否复制素材进 assets/
})
// => { ok:true,
//      outDir, entry, style, animations,
//      plan: { title, palette, sections:[{id,purpose}] },
//      blocks: [{ id, bytes }],
//      assets: { count, manifest },
//      review: { scores:{概念,哲学一致性,视觉层级,细节执行,功能性,创新性}, issues:[{dimension,problem,fix}], verdict } | null,
//      usage: { promptTokens, completionTokens, costUsd, calls } }
```

模型 key 只从环境变量或 `~/.design-deployer-llm.json` 读取，**不经过渲染层、不落日志、不进仓库**。
可用环境变量：`DD_LLM_PROVIDER` `DD_LLM_MODEL` `DD_LLM_BASE_URL` `DD_LLM_API_KEY`，
或各厂商专属的 `DEEPSEEK_API_KEY` / `ARK_API_KEY` / `DASHSCOPE_API_KEY` / `MOONSHOT_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`。

```js
// 素材预检（只出计划，不改文件）
const res = await dd.assetsScan({ dir: 'D:\\素材' })
// => { ok:true, scan:{…}, plan:{ renames, copyList, blockers, warnings, todos, skipped, stats, tools },
//      text: '人读报告' }
```

## 3.5 截图自检

用 Electron 自身的 Chromium 截图并检查页面，不需要 playwright。

```js
const res = await dd.selfcheck({ dir: outDir, shotsDir: null, fullPage: true })
// => { ok:true,
//      report: {
//        ok, dir, entry, checkedAt, shotsDir,
//        viewports: [{ viewport, size, scrollHeight, overflowX, shot }],
//        findings: [{ level:'error'|'warn'|'info', code, title, detail, needsScreenshot? }],
//        summary: { errors, warnings, infos, images, brokenImages, overflowX, exceptions, netFailures, confirmedAtRuntime }
//      },
//      text: '人读报告' }
```

`code` 取值：`JS` `CONSOLE` `CONSOLE-WARN` `NET` `C5`（裂图）`OVERFLOW`（横向溢出）
`C6`（动效元素初始不可见，测前已强制显形）`C7`（疑似文字重叠，需看截图确认）`META` `SEO` `A11Y` `PROBE`。

> `C7` 历史上经常是检测误报（同一行相邻加粗 / 数字片段），因此判 `warn` 而非 `error`。

## 4. 逐项选择

渲染层为每个 `Finding` / `ImageFinding` 维护一个决定，无需调用接口：

```js
decisions[id]      = 'mask' | 'delete' | 'hideblock' | 'keep'   // 文本项，默认取 finding.defaultAction
imageDecisions[id] = 'mask' | 'delete' | 'keep'                 // 图片项，mask = 模糊打码
```

- `mask`：按规则掩码（手机号 `138****8000`、邮箱 `de***@example.com`、姓名 `王**`…）
- `delete`：删除该处文本
- `hideblock`：删除该处文本，并把所在条目 / 卡片整块隐藏
- `keep`：原样保留

## 5. 插件与工具（自动安装）

```js
await dd.tools.status()
// => { ok:true, tools: ToolsStatus }

await dd.tools.setup()   // 幂等；后台安装缺失项，进度用 events 推送；可随时重复调用
// => { ok:true, tools: ToolsStatus }

await dd.tools.loginGithub()   // 弹出一个真实终端窗口跑 gh auth login，轮询登录状态，成功后 resolve
// => { ok:true, user:'<用户名>' } | { ok:false, error:{...} }

await dd.tools.loginWithToken(token)   // 备用：PAT 登录（gh auth login --with-token）
// => { ok:true, user }
```

```js
ToolsStatus = {
  node:  { ok, version },
  npm:   { ok, version },
  git:   { ok, version, path },
  gh:    { ok, version, path, source:'system'|'bundled', installing:false },
  auth:  { loggedIn:false, user:null, scopes:[], host:'github.com', protocol:'https' },
  sharp: { ok:false, version:null, installing:false, error:null },   // 图片打码插件（error 目前恒为 null，失败详情走日志）
  net:   { ok:true, checkedAt }
}
```

> `dd.tools.setup()` 返回 `{ ok, tools, installed:['sharp'], failed:[{name,error}] }`。
> sharp 装不上不会让 setup 失败——只在生成时自动降级为「同尺寸 SVG 占位图」。

## 6. 生成（打码 → 建站目录）

```js
const res = await dd.build({
  root,
  decisions,        // 见 §4
  imageDecisions,
  exclude: ['assets/video-jianji.mp4'],   // 用户勾选“不上传”的大文件 / 目录（可空）
  options: {
    stripExif: true,          // 剥离 JPEG 的 EXIF/GPS（默认 true）
    siteTitle: null,          // 覆盖 <title>，null = 不改
    addNotice: false,         // 页面底部加“已脱敏”小字
    workDir: null,            // 输出父目录（主进程传 userData/workspaces）；缺省用临时目录
    toolsDir: null,           // 插件目录（找 sharp 用）
    customKeywords: []        // 用户自定义关键词：会作为一条 high 级“自定义关键词”规则参与脱敏（长度 < 2 的忽略）
  }
})
// => {
//   ok:true, outDir, name, workDir, indexHtml, reportPath, generatedAt,
//   applied: [{ id, ruleId, ruleLabel, category, value, action, count, files }],
//   remaining: [{ value, ruleId, ruleLabel, count, files }],   // 选择“保留”的，会原样公开
//   images: [{ rel, action, mode?, stripped?, ok, error? }],    // 图片处理明细（用于报告）
//   excluded: [...], hiddenBlocks: 3, editCount: 28,
//   leftover: [{ value, ruleId, ruleLabel, action, count, files }],  // 自检发现“选了隐藏却还在”的
//   hasUnderscoreDir: true,      // 站点里有 _ 开头的目录（已用 .nojekyll 兜住）
//   stats: { files, bytes }, warnings: [...]
// }
```

## 7. 本地预览

```js
await dd.preview.start({ dir: outDir })
// => { ok:true, url:'http://127.0.0.1:34567/', port }
await dd.preview.stop()
```

## 8. 上线 GitHub Pages

```js
const res = await dd.deploy({
  dir: outDir,
  repoName: 'my-portfolio',
  description: '个人作品展示网站',
  siteType: 'project' | 'user',   // user 站点要求 repoName === `${user}.github.io`，链接为 https://user.github.io/
  visibility: 'public',
  reuse: false,                   // 仓库已存在时：false → 直接报 E_REPO_EXISTS 由 UI 询问；true → 覆盖推送
  commitMessage: 'chore: 上线个人设计网站',
  forbiddenValues: ['13800138000', 'demo@example.com'], // 由 build.applied 里 action!=='keep' 的原值生成；
                                                          // 上线后主进程会抓取真实链接复核这些字符串是否还在
  reportPath: 'D:\\...\\作品展示网站-123456-脱敏报告.md'   // 可选：上线成功后把链接追加写进这份报告
})
// => {
//   ok:true, url:'https://<用户名>.github.io/my-portfolio/',
//   repoUrl:'https://github.com/<用户名>/my-portfolio',
//   owner, repo, siteType, visibility, commitSha, fileCount, pushedBytes, elapsedMs,
//   pages: { status:'built', htmlUrl, httpsEnforced:true, buildLogUrl },
//   verify: { ok:true, httpStatus:200, checkedAt, checkedValues:9, leftover:[], attempted:1 },
//   warnings: [...]
// }
```

`deploy` 内部步骤（每一步都会推 `progress` + `log`）：
`git init` → `git add/commit` → 仓库探测/创建 → `git push` → 开启 Pages(POST/PUT) → 轮询构建状态 → 强制 HTTPS → 访问真实链接复核敏感信息是否已消失。

## 9. 系统能力

| 接口 | 说明 |
| --- | --- |
| `dd.shell.openExternal(url)` | 用系统浏览器打开链接 |
| `dd.shell.openPath(p)` | 打开文件夹 / 文件 |
| `dd.clipboard.write(text)` | 写剪贴板（复制上线链接） |

## 10. 事件

```js
const off = dd.on('log', (e) => {})
// e = { scope:'make'|'scan'|'tools'|'build'|'deploy'|'preview'|'check', level:'info'|'ok'|'warn'|'error'|'cmd', message, ts }

dd.on('progress', (e) => {})
// e = { scope, percent:number|null, label:string }   // percent=null → 不确定进度（转圈）

dd.on('tools', (t) => {})   // t = ToolsStatus，任何工具状态变化时推送完整快照
```

## 11. 推荐的界面流程（5 步）

1. **开始**：两个入口 ——「AI 生成网页」（一句话需求 + 风格 + 可选素材目录 → `dd.generate`，
   成功后可直接「继续：扫描敏感信息」跳进第 2 步）与「已有设计稿」（大号拖拽区 +「选择文件夹」）。
   导入后显示站点概览（文件数、总体积、入口、大文件警告）。
   进入本步即调用 `dd.tools.status()` 并自动 `dd.tools.setup()`（满足"用户选择隐藏的同时自动装好插件"）。
2. **敏感信息**：左侧按类别分组列出 `findings` + `images`，每条右侧四选一（打码 / 删除 / 隐藏整块 / 保留），
   显示命中次数、文件与代码上下文；图片项给“模糊 / 删除 / 保留”三选一。底部自定义关键词输入框可补扫。
3. **生成**：大文件清单勾选是否排除 → 「生成上线目录」→ 显示 `applied` / `remaining` / 警告 + 「本地预览」。
4. **上线**：仓库名、站点类型、可见性；未登录时显示「登录 GitHub」按钮（`dd.tools.loginGithub`）；
   点「开始上线」后展示分步进度条与实时日志。
5. **完成**：大号可点击链接 + 复制按钮 + 打开仓库/构建日志 + 复核报告（线上是否仍有残留）。

# 设计稿上线助手（DesignDeployer）

> **一句话生成网页 → 自动脱敏 → 一键上线**到 GitHub Pages，并把可访问的链接交还给用户。

一个 Electron 桌面程序 + 一套等价的命令行工具。它替你完成
「生成网页（可选）→ 扫描敏感信息 → 逐项确认处理方式 → 生成脱敏后的上线目录 → 建库 → 推送 → 开启 Pages → 复核线上页面」的全部工作。

> **为什么还要脱敏？** AI 生成的个人主页里，大概率带着你喂给它的真实手机号、邮箱、照片 GPS。
> 本项目在生成之后立刻接管：21 条规则扫一遍 → 你逐项决定 → 改写后再自检一遍 → 上线后抓真实链接复核一遍。

---

## 一、项目简介

毕业作品集、个人简历页、作品展示网站通常是这样诞生的：本地一个文件夹，里面是 `index.html` + `assets/`，用浏览器双击就能看。想把它发给别人（老师、面试官、同学），就得把文件夹压缩发送，或者自己折腾 GitHub Pages。

**本项目解决的问题**：把「一个本地 HTML 设计稿文件夹」变成「一个可公开访问的网址」这件事，从「要懂 Git / GitHub / Pages / 命令行」降到「拖进去、点几下、拿到链接」。并且在这一过程中，把文件里**本来不该公开的个人信息**（手机号、邮箱、身份证、学号、微信号、详细住址、密钥、照片的 GPS 坐标与人像）自动找出来，交给你逐项决定怎么处理。

设计稿本身、上传的站点文件、脱敏报告**全部只留在你自己的电脑上**。程序只在你点击「开始上线」之后，才把生成好的站点目录推送到你自己的 GitHub 仓库。

---

## 二、功能清单（对照需求）

### 2.0 从一句话生成网页（可选起点）

如果你手上还没有设计稿，程序的第 1 步提供「AI 生成网页」入口：写一句话描述需求（可附素材目录），
自动完成下面这条链，产出标准 `index.html` + `assets/`，直接接进后面的脱敏与上线。

| 阶段 | 做什么 | 代码 |
| --- | --- | --- |
| 0 初始化 | 写出 `rule.md`（建站规则）与 `log.md`（进度日志） | `lib/generate.js` |
| 1 素材规整 | 素材复制进 `assets/`、文件名转 ASCII、探测视频编码与源工程、查重复图 | `lib/assets.js` |
| 2 结构规划 | 模型只做**区块规划**（JSON），不写 HTML | `lib/generate.js` |
| 3 分块生成 | 每个区块单独一次调用，失败只坏一块、可单独重做 | `lib/generate.js` |
| 4 确定性组装 | 骨架 / 样式 / 拼装全是代码，不调模型 | `lib/generate.js` |
| 5 设计评审 | 六维度打分 + 必须修的改动清单（可选，`--review`） | `lib/generate.js` |
| 6 截图自检 | Electron 截图 + JS 异常 / 裂图 / 横向溢出 / 文字重叠 | `lib/selfcheck.js` |

**模型可插拔**：内置 7 家预设（mock / DeepSeek / 火山方舟豆包 / 通义 / Kimi / OpenAI / Claude），
统一走 OpenAI 兼容格式，带超时、指数退避重试、主备降级与成本计量。**没有 API key 也能跑**——
默认的 `mock` 适配器返回确定性示例页面，用来跑通全流程与评测基线。

**素材规整把关的五条硬约束**（都是手工实操时真踩过的坑）：

| 编号 | 约束 | 不遵守会怎样 |
| --- | --- | --- |
| C1 | 素材文件名必须 ASCII / 拼音 | 发布后裂图 |
| C2 | 视频必须 H.264 | HEVC 浏览器播不了（手写 MP4 box 解析探测） |
| C3 | PSD / AEP 不能直接展示 | 需先导出预览图 |
| C4 | 视频要抽首帧做封面 | 灯箱黑屏 |
| C5 | 图片必须写死静态 `src` | 靠 JS 注入会在发布后裂图 |

### 2.1 拖入设计稿文件夹 → 自动扫描并归纳个人敏感信息

把文件夹拖进窗口（或点「选择文件夹」/「选择 index.html」），程序立刻递归遍历整个站点，把命中内容**按「值」聚合**——同一个邮箱在页面里出现 3 次只算 1 项，你只需要做 1 次决定。

扫描范围与限制（与实现一致）：

| 项目 | 行为 |
| --- | --- |
| 目录深度 | 最多向下 12 层 |
| 跳过目录 | `.git`、`.svn`、`.hg`、`node_modules`、`__pycache__`、`.idea`、`.vscode`、`.npmcache` |
| 符号链接 | 直接跳过，不跟随 |
| 文本文件上限 | 单文件大于 8 MB 不扫描 |
| 图片元数据上限 | 单张图片大于 24 MB 不读取 EXIF（会在条目上标注「文件较大，未读取元数据」） |
| 大文件阈值 | 默认 50 MB，超过即进入「大文件清单」 |
| 入口定位 | 优先 `index.html`；没有再向下找一层唯一含 `index.html` 的子目录；有多个候选会报 `E_BAD_INPUT` 让你直接选一个；都没有时取第一个 `*.html` 作入口并给出提示；一个 HTML 都没有时仍可继续（`indexHtml = null`） |

**文本类规则库**（`lib/rules.js`，共 21 条内置规则 + 1 条自定义规则）：

| 规则 id | 界面标签 | 类别 | 危险级别 | 默认建议 | 打码后长什么样 |
| --- | --- | --- | --- | --- | --- |
| `secret_key` | 密钥 / 访问令牌 | 账号凭据 | 高 | 打码 | `[已移除的密钥]` |
| `private_key` | 私钥文件内容 | 账号凭据 | 高 | 打码 | `[已移除的私钥]` |
| `url_token` | URL 里携带的令牌 | 账号凭据 | 高 | 打码 | `[已移除]` |
| `id_card` | 身份证号 | 身份信息 | 高 | 打码 | 保留前 6 位与后 4 位 |
| `bank_card` | 银行卡 / 账号 | 身份信息 | 高 | 打码 | `**** **** **** 1234`（需通过 Luhn 校验） |
| `mobile_cn` | 手机号码 | 联系方式 | 高 | 打码 | `181****6217` |
| `mobile_masked` | 已部分打码的手机号 | 联系方式 | 中 | **保留** | `181****6217` |
| `email` | 邮箱地址 | 联系方式 | 中 | 打码 | `de***@example.com` |
| `qq` | QQ 号 | 联系方式 | 中 | 打码 | 保留前 3 位（需附近出现「QQ」字样） |
| `wechat` | 微信号 | 联系方式 | 高 | 打码 | 保留前 2 位 |
| `name_cn` | 中文姓名 | 身份信息 | 高 | 打码 | `杨**` |
| `name_guess` | 疑似姓名（请人工确认） | 身份信息 | 中 | **保留** | `杨**` |
| `name_en` | 英文 / 拼音姓名 | 身份信息 | 中 | 打码 | `Y*** G*****` |
| `birth_date` | 出生年月 | 身份信息 | 中 | 打码 | `1999.**`（月份变 `**`） |
| `address_full` | 详细住址 | 位置信息 | 高 | 打码 | `云南**（详细地址已隐藏）` |
| `student_id` | 学号 / 工号 | 身份信息 | 高 | 打码 | 保留前 2 位与后 2 位 |
| `city` | 城市 / 所在地区 | 位置信息 | 低 | **保留** | `昆*` |
| `school` | 学校名称 | 教育职业 | 低 | **保留** | `某学校` |
| `company` | 公司 / 单位名称 | 教育职业 | 低 | **保留** | `某公司` |
| `gender_ethnic` | 性别 / 民族 | 身份信息 | 低 | **保留** | `已隐藏` |
| `social_handle` | 社交平台账号 | 联系方式 | 低 | **保留** | `github.com/[已隐藏]` |
| `custom` | 自定义关键词 | 身份信息 | 高 | 打码 | 首字 + `*` |

姓名识别做了三层，避免把正文里的普通词误判成人名：

1. **语境明确型**：`姓名：王小明`、`作者 王小明`、`王小明 · 个人简历`、`alt="王小明工作照"`；
2. **结构化型**：`<h1 class="hero-name">杨<b>国鑫</b></h1>`——名字被标签拆开也能识别，并记录被拆散的字符区间；
3. **猜测型**（`name_guess`）：百家姓开头的 2~4 字组合，只有紧跟在「个人简历 / 工作照 / 同学 / 先生 / 女士」等线索词后、或处在 `class="hero-name"`、`alt="…工作照"` 这类人名语境里才采纳，且默认是「保留」，需要你人工确认。

疑似的关键词黑名单（`NAME_STOP`）会挡掉「中国」「人民日报」「作品集」「联系方式」等常见误报。

其它会挡住误报的二次确认（`gate`）：银行卡要过 Luhn 校验；QQ 号要求附近出现「QQ / 扣扣 / 企鹅」；出生年月要求附近出现「出生 / 生日 / 生于 / 年龄 / born / Birth」；学校名要排除「全国 / 大赛 / 评选」等非校名语境。

**图片类**（`lib/scanner.js` + `lib/exif.js`）：

| 标记 | 触发条件 |
| --- | --- |
| `人像照片` | 文件名或相对路径命中 `证件照 / 工作照 / 生活照 / 头像 / 照片 / 自拍 / 个人照 / portrait / avatar / profile / selfie / photo / idcard / id-card`，或页面里该图 `<img alt="…">` 命中同样关键词 |
| `含拍摄地点(GPS)` | JPEG 的 EXIF GPS IFD 能解析出经纬度（南纬 / 西经会转成负值，保留 6 位小数） |
| `含 EXIF 元数据` | JPEG 里存在 EXIF；PNG 里存在 `tEXt / iTXt / zTXt` 文本块 |
| `EXIF 含作者名` | EXIF `Artist` 标签非空 |
| `EXIF 含中文描述` | EXIF `ImageDescription` 里含中文 |
| `EXIF 含软件信息` | EXIF `Software` 标签非空 |

图片项的默认建议：**人像照片 → 打码**；**含 GPS 或其它敏感元数据 → 打码**；其余 → 保留（保留的图片在生成时仍会被剥离元数据）。清单排序为「人像优先 → 含 GPS 次之 → 体积从大到小」。

### 2.2 用户逐项选择处理方式

| 处理方式 | 文本项的行为 | 图片项的行为 |
| --- | --- | --- |
| **打码** | 用规则对应的掩码替换原文 | **模糊打码**：真高斯模糊（见下） |
| **删除** | 删掉这一处文本；如果所在条目因此变空，**自动整块隐藏** | 从上线目录里删除该图片 |
| **隐藏整块** | 删掉文本，并把最近的「卡片 / 条目」祖先元素整块隐藏 | 图片项不支持（界面会提示） |
| **保留** | 原样公开 | 原样公开（但仍会清除 EXIF / GPS） |

- 界面上每个文本项会显示 `→ 打码后的实际效果`（由规则自身的 `mask()` 真实计算，不是示意），以及「查看命中位置（N）」，展开后逐条给出 `文件:行:列`、位置种类（文本 / 属性 / 注释 / 原始文本）、所在标签与属性名（如 `<a> @href`）、以及命中处用 `⟪ ⟫` 标出的代码上下文片段。
- 图片项显示缩略图、尺寸、体积、命中的标签、默认建议、EXIF 摘要（设备 / 软件 / 拍摄时间），命中 GPS 时额外显示 `⚠ 照片含拍摄地点坐标（lat, lng）`。图片项**没有**模糊效果预览图，只给出可读的元数据与建议。
- 顶部支持按类别筛选（全部 / 联系方式 / 身份信息 / 账号凭据 / 位置信息 / 教育职业 / 图片）与「全部打码 / 全部删除 / 全部隐藏整块 / 全部保留」批量操作，批量只作用于当前筛选结果。
- 底部还有「自定义关键词」输入框：适合补上程序猜不到的内容（真实姓名、宿舍楼号）。关键词命中的条目会被置顶并打上「自定义命中」标记；**真正的打码发生在生成阶段**——生成时主进程会带着这批关键词重新命中一遍，命中内容一律按打码处理。

### 2.3 勾选的同时，后台自动装好插件与工具

右侧「环境与插件」面板在进入第 1 步时就会 `status → 缺失即 setup`，你不需要单独点任何「安装」按钮。幂等，重复调用不会重复安装。

| 组件 | 检测 | 缺失时的自动处理 |
| --- | --- | --- |
| Git | `PATH` + `C:\Program Files\Git\cmd\git.exe` 等常见路径 | `winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity`（无 `winget` 时给出官网链接让你手装） |
| GitHub CLI | 程序插件目录 → `gh` 所在常见路径 | 调 `https://api.github.com/repos/cli/cli/releases/latest` 拿最新版，下载官方 `windows_amd64.zip`（arm64 机器取 `windows_arm64.zip`），用 `tar -xf` 解压，失败再退回 PowerShell `Expand-Archive`。**全程解压到程序插件目录，不需要管理员权限** |
| sharp（图片打码插件） | 插件目录 `node_modules/sharp` | `npm install sharp --prefix <插件目录> --no-audit --no-fund --loglevel error --cache <插件目录>/npm-cache`；**装不上则自动降级**为同尺寸 SVG 占位图 |
| GitHub 登录 | `gh auth status --hostname github.com` | 弹出**真实终端窗口**执行 `gh auth login --hostname github.com --git-protocol https --web`，程序每 2.5 秒轮询登录状态，最多等 5 分钟 |

插件与工具的落位（与代码一致）：

| 运行方式 | 插件 / 工具目录 |
| --- | --- |
| 桌面程序 | `%APPDATA%\设计稿上线助手\tools`（即 Electron `userData/tools`） |
| 命令行 | 环境变量 `DD_TOOLS_DIR`，未设置时为 `~/.design-deployer-tools` |

### 2.4 生成上线目录

点「生成上线目录」后，程序在自己的工作区里**复制**一份站点并改写（**原始文件夹全程只读，不会被修改**）：

| 阶段 | 做了什么 |
| --- | --- |
| 1. 复制 | `cp -r` 到 `<工作区>/<站点名>-<YYYYMMDD-HHMMSS>`，跳过 `.git`、`node_modules`、`.DS_Store`、`Thumbs.db` 与你勾选排除的路径 |
| 2. 图片先处理 | 打码 / 删除 / 保留三种决定分别落地；因为打码可能把 `a.jpg` 换成 `a.hidden.svg`，所以图片必须先处理，文本改写才知道该替换哪些引用 |
| 3. 文本改写 | 对生成目录里的每个文本文件**按规则重新命中一遍**，再查你的决定，生成一组编辑，最后**一次性倒序应用**，保证偏移量不会错乱 |
| 4. 处理引用 | 引用了被排除 / 被删除文件的元素会被摘掉：`<img>/<video>/<source>/<audio>/<iframe>/<track>/<embed>/<object>` 整个标签删除；`data-src` / `data-video` 这类 `data-*` 属性连属性一起摘掉；其余属性清空属性值；同时把最近的「卡片」祖先整块隐藏 |
| 5. 删除后变空 | 「删除」导致某条目只剩标签、没有可见文本且不含图片 / 视频时，自动往上找到最外层「还是空的」祖先，加 `data-dd-hidden="1"` 整块隐藏 |
| 6. 注入隐藏样式 | 只要出现过整块隐藏，就往 `</head>` 前插入 `<style data-design-deployer="hide">[data-dd-hidden]{display:none!important}</style>` |
| 7. 图片元数据 | 「保留」的 JPEG 会**无损剥离** APP1~APP15 与 COM 段（保留 APP0/JFIF 与压缩数据，画质零损失）；PNG 剥离 `tEXt / iTXt / zTXt / eXIf / tIME` 块 |
| 8. `.nojekyll` | 恒定写入一个空的 `.nojekyll` |
| 9. 自检 | 对**生成结果**再完整扫一遍；凡是「你选了隐藏却还能扫到」的内容一律报错列出，并写进报告的「自检未通过」章节（掩码产物如 `***`、`已隐藏`、`某学校` 会被排除，不算漏网） |
| 10. 报告 | 写一份 Markdown 脱敏报告到工作区（见 2.7） |

图片「模糊打码」的实现（`lib/images.js`）：

1. **sharp 可用**：先按 `min(宽, 640) / 14` 缩到小尺寸，`blur(24/3)` 高斯模糊，再放大回原尺寸重新编码（PNG 出 PNG，其余出 JPEG，质量 72）。「缩小 → 模糊 → 放大」比直接大半径模糊更难还原，也不会糊成一片灰色。重新编码顺带把 EXIF / GPS 全部抹掉。
2. **sharp 不可用或处理失败**（如 avif/heic）：读原图尺寸，生成一张**同尺寸**的 SVG 占位图（斜纹底 + 「人物照片已隐藏 / 图片已隐藏」字样 + `Protected by DesignDeployer`），写到 `原名.hidden.svg` 并删除原图，同时把页面里对该图的引用改成新文件名，保证版式不塌、隐私不泄露。

### 2.5 本地预览

内置一个静态 HTTP 服务（默认监听 `127.0.0.1` 的**随机空闲端口**，不是 `file://`），因此相对路径、`fetch`、字体、以及**视频的 Range 请求**（`bytes=` 分段，返回 `206` + `Content-Range` + `Accept-Ranges`）行为都和线上一致。点「本地预览」会顺手用系统浏览器打开，界面上同时给出 `http://127.0.0.1:<端口>/` 链接与「停止预览」按钮；关掉程序时会自动停掉服务。

### 2.6 一键上线

用户只需要做两件事，其余命令全部由程序执行：

1. **勾选要隐藏哪些信息**（第 2 步）；
2. **登录 GitHub 账号**（第 4 步，在真实终端里走浏览器授权；也支持粘贴 Personal Access Token 备用登录）。

| 步骤 | 实际执行的命令 / 请求 | 失败时 |
| --- | --- | --- |
| 0. 前置检查 | 检查目录存在、找到 `git`、找到 `gh`、确认已登录 | `E_NOT_FOUND` / `E_GIT` / `E_NO_GH` / `E_NOT_LOGGED_IN` |
| 1. 探测仓库 | `gh api repos/{owner}/{repo} --jq .full_name` | 已存在且未选「覆盖推送」→ `E_REPO_EXISTS` |
| 2. 本地提交 | `git init -b main`（老版本 Git 退回 `git init` + `git checkout -b main`）、`git add -A`、`git -c user.name=… -c user.email=… commit --allow-empty -m <提交信息>` | `E_GIT` |
| 3. 建库并推送 | `gh repo create <owner>/<repo> --public|--private --source <目录> --remote origin --push --description …`；若该命令失败，退回 `git remote add origin https://github.com/<owner>/<repo>.git` + `git push -u origin HEAD:main --force` | `E_GIT` |
| 4. 开启 Pages | `gh api --method POST repos/{owner}/{repo}/pages -f source[branch]=main -f source[path]=/`；失败改为 `PUT` | 私有仓库 → `E_PAGES` |
| 5. 轮询构建 | 每 6 秒查一次 `/pages`，最多等 7 分钟（420 秒）；状态 `errored` 立即报 `E_PAGES` 并给 Actions 链接 | 超时只记 warning，仍然把链接给你 |
| 6. 强制 HTTPS | 最多 6 轮、每轮间隔 10 秒，`PUT /pages -F https_enforced=true` | 证书还在签发时提示「证书还在签发中，10 秒后重试…」；最终失败只记 warning |
| 7. 线上复核 | 带 `?_dd=<时间戳>` 与 `Cache-Control: no-cache` 抓取真实链接，最多 8 次、间隔 15 秒，检查页面里是否还能找到「你选择隐藏的原值」 | 未通过只记日志并在界面标红，不阻断 |
| 8. 报告留档 | 往脱敏报告追加「上线信息」（线上地址 / 仓库地址 / 可见性 / Pages 状态 / HTTPS / 复核结论 / 时间） | — |

生成链接的规则：

| 站点类型 | 仓库名要求 | 访问链接 |
| --- | --- | --- |
| 项目站点（默认） | 任意合法仓库名（如 `my-portfolio`） | `https://<用户名>.github.io/<仓库名>/` |
| 用户站点 | 必须是 `<用户名>.github.io`，否则自动修正 | `https://<用户名>.github.io/` |

提交身份使用 GitHub 用户名与 `<用户名>@users.noreply.github.com`，不会向仓库里写入你的真实邮箱。命令执行环境里固定设置了 `GIT_TERMINAL_PROMPT=0` / `GH_PROMPT_DISABLED`，避免子进程卡在交互式密码输入上。

### 2.7 脱敏报告

生成阶段会写一份 Markdown 报告到工作区：

```
<工作区>/<站点名>-<HHMMSS>-脱敏报告.md
```

内容包含：基本信息表（源站点 / 上线目录 / 入口文件 / 生成时间 / 文件数 / 体积 / 文本改写处数 / 整块隐藏处数）、**一、已处理的敏感信息**（类别 / 类型 / 内容 / 处理方式 / 次数 / 涉及文件）、**二、保留未处理（将随站点公开）**、**三、⚠ 自检未通过**（仅在有问题时出现）、**四、图片处理**、**五、排除未上传的文件**、**六、提示**。

报告里的敏感值全部经过**软打码**（只保留约 1/4 前缀，其余换成 `*`）。报告只留档在本地工作区，不会被上传；`gh repo create --source <目录>` 推送的是**生成目录**本身，报告在它的上一级目录里，不在推送范围内。

---

## 三、快速开始

### 3.1 从源码运行

```bat
cd design-deployer
npm install
npm start
```

或者直接双击项目根目录的 **`启动.bat`**：它会检查 Node.js、把 npm 缓存指到程序目录、首次运行时自动 `npm install`，最后用 `npx electron .` 启动。

要求：**Node.js 18 以上**（用到了内建 `fetch` 与 `fs.cp`）。Git 与 GitHub CLI 不需要预先安装，程序会自己装。

其它脚本：

```bat
npm run dev        :: 带 --dev 启动
npm run cli -- tools --setup    :: 用命令行准备环境
npm run check      :: 契约一致性静态校验（主进程/预加载/界面对齐，125 项）
npm run smoke      :: 端到端冒烟测试（自动生成合成测试站 → 扫描 → 生成 → 预览，46 项断言）
npm run test:llm   :: 模型适配器测试（本地假模型服务器，验证重试/流式/降级/成本，29 项断言）
npm run ui         :: 自动走一遍五步界面并截图到 shots/（需要有图形界面）
npm run icon       :: 生成程序图标（build/icon.ico，纯 JS 画，零依赖）
npm run dist       :: 一次打出安装包 + 便携版 exe（输出到 dist/）
npm run dist:installer :: 只打安装包
npm run dist:portable  :: 只打便携版
npm run dist:dir   :: 只生成解包目录，不压 exe
```

产物（`dist/` 目录下）：

| 文件 | 说明 |
| --- | --- |
| `设计稿上线助手-安装包-<版本>.exe` | 带向导的安装程序：可选安装目录、**有「创建桌面快捷方式」勾选框**、注册开始菜单项、自带卸载程序（控制面板可见） |
| `设计稿上线助手-便携版-<版本>.exe` | 免安装单文件，双击即用（不带快捷方式，适合 U 盘里放着用） |

安装包的行为细节（都在 `build/installer.nsh` 里实现，可自行修改）：

- 安装类型默认 **仅为当前用户**（不需要管理员权限，装到 `%LOCALAPPDATA%\Programs\设计稿上线助手`）；也可以在选择页里改成「为所有用户安装」，这时会弹 UAC 提权。
- 第三步「安装选项」页有一个默认勾选的 **创建桌面快捷方式（推荐）**；取消勾选就只在开始菜单里创建。
  这个选择会写进 `HKCU\Software\DesignDeployer`，因为「为所有用户安装」会触发 UAC 二次启动，NSIS 变量在内外两个实例间不共享，直接带变量会丢。
- 卸载时会自动删掉桌面快捷方式（我们关掉了 electron-builder 自带的 `createDesktopShortcut`，所以必须自己清，否则桌面会留下死链接）。
- 静默安装（`安装包.exe /S`）不显示任何页面，此时按「创建桌面快捷方式」处理。

> 打包脚本：双击 **`打包安装包.bat`**（会先生成图标、必要时自动装依赖、然后把两个 exe 都打出来，日志写在 `打包日志.txt`）。
> 国内网络建议先设镜像，脚本失败时也会提示：
> `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 与
> `set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

> 如果 `npm install` 卡在下载 Electron 运行库（国内网络常见），可以先设置镜像再装：
> `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 然后重新 `npm install`。
> `postinstall` 会自检并提示这件事，不会阻塞安装。

### 3.2 界面流程

| 步 | 标题 | 你要做的事 |
| --- | --- | --- |
| 1 | 开始 | 两个入口：**「AI 生成网页」**（写一句话需求 → 生成 → 直接跳进第 2 步）或**「已有设计稿」**（拖入文件夹 / 点「选择文件夹」/「选择 index.html」） |
| 2 | 敏感信息 | 逐项选择「打码 / 删除 / 隐藏整块 / 保留」 |
| 3 | 生成目录 | 勾选不上传的大文件 →「生成上线目录」→ 可选「本地预览」 |
| 4 | 上线 Pages | 未登录先点「登录 GitHub 账号」→ 填仓库名 →「开始上线」 |
| 5 | 完成 | 点链接或「复制链接」，把网址发给别人 |

详细的「你会看到什么 / 你该点什么」请见 [`docs/使用说明.md`](docs/使用说明.md)。

---

## 四、命令行用法

`bin/dd-cli.cjs` 提供了与图形界面等价的能力，适合自动化、批量处理与答辩演示。

```bat
node bin/dd-cli.cjs <子命令> [...]
:: 等价写法
npm run cli -- <子命令> [...]
```

### 4.0 `make` —— 一句话生成网页 → 脱敏 →（可选）上线

```bat
:: 不需要任何 API key，mock 模型就能跑通全流程
node bin/dd-cli.cjs make .work\my-site --brief "个人作品集单页，含作品列表与联系方式"

:: 带素材 + 真模型 + 设计评审 + 直接上线
node bin/dd-cli.cjs make .work\my-site --brief "个人作品集" --src "D:\素材" ^
    --provider deepseek --model deepseek-chat --style newspaper --review ^
    --policy mask-all --deploy --repo my-portfolio
```

| 参数 | 说明 |
| --- | --- |
| `--brief` | 必填，一句话说清用途 / 内容 / 风格 |
| `--src` | 素材来源目录（可选） |
| `--style` | `plain` / `newspaper` / `pastel` / `dark` |
| `--anim` | `level1`（默认，优雅档动效）/ `none` |
| `--review` | 生成后跑一次六维度设计评审 |
| `--provider` `--model` | 覆盖默认模型；缺省用 `mock` |
| `--no-redact` | 只生成，不接脱敏链路 |

模型 key 走环境变量，**永不进仓库、不打日志**：
`DEEPSEEK_API_KEY` / `ARK_API_KEY`（火山方舟·豆包）/ `DASHSCOPE_API_KEY` / `MOONSHOT_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`，
或统一用 `DD_LLM_API_KEY` + `DD_LLM_PROVIDER` + `DD_LLM_MODEL`。

### 4.0b `assets` —— 素材预检（只出计划，不动文件）

```bat
node bin/dd-cli.cjs assets "E:\素材"
node bin/dd-cli.cjs assets "E:\素材" --apply "E:\我的作品集\assets"
```

报告内容：文件名风险、视频编码（H.264 / HEVC）、源工程（PSD/AEP）、重复图片、超大图片、单文件超限，
并直接给出需要执行的 ffmpeg 命令。

### 4.0c `check` —— 截图自检（需 Electron）

```bat
node bin/dd-cli.cjs check .work\my-site --json 自检报告.json
```

用 Electron 内置的 Chromium 打开页面，产出桌面 / 移动端截图，检查
JS 运行时异常、console 报错、资源加载失败、裂图、横向溢出、文字重叠、viewport meta、标题层级。
**不需要 playwright。**

### 4.1 `scan` —— 只扫描，不做任何改动

```bat
node bin/dd-cli.cjs scan "E:\我的作品集"
node bin/dd-cli.cjs scan "E:\我的作品集" --json scan.json
node bin/dd-cli.cjs scan "E:\我的作品集" --keywords 张三,2021123456
```

列出：站点名 / 入口 / 文件数 / 体积；文本敏感项（危险级别、规则标签、值、次数、打码预览、条目 id）；图片（人像与含 GPS 的排在前面，附尺寸、体积、标签、GPS 坐标）；大文件；建议排除项；提示。`--json` 会写出**完整**扫描结果（含原始值和命中位置），注意保管。

### 4.2 `build` —— 生成脱敏后的上线目录

```bat
node bin/dd-cli.cjs build "E:\我的作品集" --policy mask-all
node bin/dd-cli.cjs build "E:\我的作品集" --policy mask-high
node bin/dd-cli.cjs build "E:\我的作品集" --policy hide-all
node bin/dd-cli.cjs build "E:\我的作品集" --policy keep-all
node bin/dd-cli.cjs build "E:\我的作品集" --interactive
node bin/dd-cli.cjs build "E:\我的作品集" --decisions 决定.json
node bin/dd-cli.cjs build "E:\我的作品集" --exclude _backup,_shots,assets/big.mp4 --out "D:\上线工作区"
```

| 参数 | 说明 |
| --- | --- |
| `--policy <名称>` | 批量策略，见下表；默认 `mask-all` |
| `--interactive` | 在终端里逐项问答，回车 = 采用建议值；文本项 `m` 打码 / `d` 删除 / `h` 隐藏整块 / `k` 保留，图片项 `m` 模糊 / `d` 删除 / `k` 保留 |
| `--decisions <文件>` | 读取决定 JSON，优先级最高 |
| `--exclude a,b,c` | 不上传的相对路径（文件或目录，目录可写成 `_backup`） |
| `--out <目录>` | 工作区（输出父目录），默认 `~/design-deployer-workspaces` |
| `--notice` | 在页面底部加一行「已脱敏」提示 |
| `--title <新标题>` | 覆盖生成页面的 `<title>` |
| `--keep-exif` | 不清理保留图片的 EXIF（默认会清理） |

策略含义：

| 策略 | 文本项 | 图片项 |
| --- | --- | --- |
| `mask-all`（默认） | 中危 / 高危 → 打码，低危 → 保留 | 人像 → 打码，其余 → 保留 |
| `mask-high` | 高危 → 打码，其余 → 保留 | 同上 |
| `hide-all` | 全部 → 隐藏整块 | 同上 |
| `keep-all` | 全部 → 保留 | 全部 → 保留 |

决定 JSON 格式：

```json
{
  "decisions": { "v:0": "mask", "v:3": "hideblock", "v:7": "keep" },
  "imageDecisions": { "img:assets/portrait-demo.png": "mask", "img:assets/old.png": "delete" },
  "exclude": ["_backup", "assets/video-ad.mp4"]
}
```

> `decisions` / `imageDecisions` 的键就是 `scan --json` 里的 `findings[].id` 与 `images[].id`。可以先 scan 出 id，再写决定文件。

### 4.3 `deploy` —— 把生成目录推上 GitHub Pages

```bat
node bin/dd-cli.cjs deploy "C:\Users\me\design-deployer-workspaces\作品集-20260101-120000" --repo my-portfolio
node bin/dd-cli.cjs deploy "<生成目录>" --repo my-portfolio --user-site
node bin/dd-cli.cjs deploy "<生成目录>" --repo my-portfolio --reuse
node bin/dd-cli.cjs deploy "<生成目录>" --repo my-portfolio --private
node bin/dd-cli.cjs deploy "<生成目录>" --repo my-portfolio --desc "个人作品展示网站"
```

| 参数 | 说明 |
| --- | --- |
| `--repo <仓库名>` | 省略时用生成目录的目录名 slug 化（非法字符换 `-`，全非法则用 `my-portfolio`） |
| `--user-site` | 建用户站点，仓库名强制为 `<用户名>.github.io` |
| `--private` | 建私有仓库（免费账号开 Pages 会失败，程序会给出提示） |
| `--reuse` | 仓库已存在时直接覆盖推送，而不是报 `E_REPO_EXISTS` |
| `--desc <描述>` | 仓库描述，默认「个人作品展示网站」 |
| `--report <报告.md>` | 单独 deploy 时，把「上线信息」追加到指定报告文件 |

### 4.4 `all` —— 扫描 → 生成 →（可选）上线，一条命令走完

```bat
node bin/dd-cli.cjs all "E:\我的作品集" --policy mask-all --exclude _backup,_shots
node bin/dd-cli.cjs all "E:\我的作品集" --policy mask-all --exclude _backup,_shots --deploy --repo my-portfolio
```

不加 `--deploy` 时只生成并在结尾提示「确认无误后加 --deploy 上线」。这是**唯一**会在上线后做「线上残留复核」的命令行入口——因为只有它手里有本次的处理清单。

### 4.5 `tools` —— 检查 / 安装环境、登录

```bat
node bin/dd-cli.cjs tools
node bin/dd-cli.cjs tools --setup
node bin/dd-cli.cjs tools --login
```

打印 Node / npm / Git / GitHub CLI / GitHub 登录 / 图片打码插件 / 网络 七项状态；`--setup` 幂等安装缺失项；`--login` 打开终端窗口走浏览器授权。

### 4.6 其它脚本

```bat
node scripts/test-scan.cjs "E:\我的作品集"     :: 只跑扫描，打印详细清单（不传目录则用合成测试站）
node scripts/test-build.cjs "E:\我的作品集"    :: 端到端跑「扫描 + 生成」，输出落在 .work/（不传目录则用合成测试站）
```

---

## 五、目录结构与文件职责

```
design-deployer/
├─ package.json              项目定义：脚本（start / dev / cli / smoke / check / dist…）、
│                            electron-builder 打包配置（NSIS 安装包 + 便携版、appId、files 白名单）
├─ build/                    打包资源（不会进安装包）
│  ├─ icon.ico               程序图标（16~256 多尺寸，由 scripts/make-icon.cjs 生成）
│  └─ installer.nsh          安装包自定义脚本：安装选项页 + 桌面快捷方式勾选框 + 卸载清理
├─ 打包安装包.bat            一键打出安装包与便携版 exe
├─ README.md                 本文件
├─ 启动.bat                  Windows 一键启动：检查 Node → 首次 npm install → npx electron .
├─ 打包便携版.bat            调用 electron-builder 生成便携版 exe
│
├─ electron/                 桌面程序外壳（只有这一层碰 Electron API）
│  ├─ main.js                主进程：窗口、应用菜单、全部 ipcMain 路由（dd:* 通道）、
│  │                         工具状态每 20 秒后台刷新、单实例锁、未捕获异常上报
│  └─ preload.js             通过 contextBridge 把能力暴露成 window.dd，并按类型分发
│                            dd:event（log / progress / tools）事件
│
├─ lib/                      与界面无关的全部业务逻辑（桌面端与命令行共用）
│  ├─ scanner.js             遍历站点 → 定位入口 → 文本规则扫描 → 按值聚合 → 图片/EXIF 扫描
│  │                         → 大文件与建议排除项 → 统计与警告
│  ├─ rules.js               敏感信息规则库：21 条规则（正则 / 自定义检测 / 上下文 gate / 打码函数）、
│  │                         百家姓与双字姓表、城市表、姓名误报黑名单、自定义关键词规则工厂
│  ├─ redactor.js            生成上线目录：复制 → 图片 → 引用摘除 → 文本改写 → 空块隐藏 →
│  │                         注入隐藏样式 / 标题 / 提示 → .nojekyll → 自检 → 报告
│  ├─ html.js                零依赖 HTML 状态机解析器：token + 元素树、位置判定（文本/属性/标签/
│  │                         注释/rawtext）、区间编辑合并、元素属性插入、卡片祖先查找、引用查找
│  ├─ images.js              图片打码（sharp 高斯模糊 / 同尺寸 SVG 占位图）与元数据剥离
│  ├─ exif.js                零依赖图片元数据：JPEG EXIF 解析（含 GPS）、JPEG APPn/COM 无损剥离、
│  │                         PNG 文本块剥离、常见格式宽高读取
│  ├─ deploy.js              上线编排：仓库探测 → git init/commit → gh repo create/push →
│  │                         开启 Pages → 轮询构建 → 强制 HTTPS → 抓取线上页面复核 → 报告留档
│  ├─ tools.js               环境检测与自动安装：Git（winget）、GitHub CLI（官方 zip）、sharp（npm）、
│  │                         GitHub 登录（终端 + 轮询）、令牌登录备用
│  ├─ preview.js             本地预览用的静态 HTTP 服务（含视频 Range 分段响应、目录穿越防护）
│  ├─ llm.js                 模型调用层：7 家预设 + 统一 OpenAI 兼容格式 + mock 适配器，
│  │                         超时 / 指数退避重试 / 主备降级 / 成本计量 / SSE 流式；key 不入日志不落仓库
│  ├─ generate.js            网页生成编排：风格预设 → 区块规划(JSON) → 分块生成 → 确定性组装，
│  │                         外加 sanitizeBlock / normalizeAssetRefs / 六维度设计评审提示词
│  ├─ assets.js              素材规整（C1–C5）：手写 MP4 box 解析探编码、手写 JPEG/PNG/WebP 尺寸、
│  │                         文件名 ASCII 化 + 语义残留判定、快速指纹查重、先出计划再执行
│  ├─ selfcheck.js           截图自检：Electron capturePage + DevTools 协议抓 JS 异常，
│  │                         查裂图 / 横向溢出 / 文字重叠（C7 误报判 warn）/ 动效盲区（C6 强制显形）
│  ├─ shell.js               子进程执行层：which / run（输出走文件重定向 + 120ms 增量轮询）/
│  │                         打开终端窗口 / 网络连通性探测 / 带重试的 fetch
│  └─ util.js                通用工具：路径与相对路径、slugify、时间戳、目录操作、体积格式化、
│                            行号列号计算、软打码、并发池、HTML 转义
│
├─ src/                      渲染层（纯原生 ES2020，无框架、无构建、无外部资源）
│  ├─ index.html             页面骨架 + 严格 CSP（default-src 'none'）+ 步骤条 / 侧栏 / 底栏
│  ├─ app.js                 五步向导的全部界面逻辑：AI 生成网页 / 拖拽导入、条目列表与选择、
│  │                         生成、预览、上线表单与实时日志、结果页；用户数据一律用 textContent 插入
│  └─ styles.css             深色主题样式
│
├─ bin/
│  └─ dd-cli.cjs             命令行入口：make / assets / check / scan / build / deploy / all / tools
│
├─ scripts/
│  ├─ make-fixture.cjs       生成全合成的测试站（假 PII / 人像图 / >50MB 视频 / _ 目录），冒烟测试用
│  ├─ smoke.cjs              端到端冒烟测试（合成测试站 + 扫描 + 生成 + 预览，46 项断言）
│  ├─ check-contract.cjs     契约一致性静态校验（125 项：IPC/API/事件/CSP/语法）
│  ├─ test-llm.cjs           模型适配器测试：本地假模型服务器验证重试/流式/降级/成本（29 项）
│  ├─ selfcheck.cjs          截图自检的 Electron 入口（供 dd-cli check 调用）
│  ├─ verify-online.cjs      复核真实线上页面是否还有应隐藏的原值
│  ├─ ui-drive.cjs           用 Electron 走查五步界面并截图（需桌面环境）
│  ├─ make-icon.cjs          纯 JS 生成 build/icon.ico（含 PNG 预览，零图形依赖）
│  ├─ verify-installer.cjs   校验打包产物
│  ├─ test-scan.cjs          只测扫描的开发脚本
│  ├─ test-build.cjs         测「扫描 + 生成」的开发脚本（输出到 .work/，默认用合成测试站）
│  └─ chmod-note.cjs         postinstall：自检 Electron 运行库并打印下一步提示
│
├─ docs/
│  ├─ IPC_CONTRACT.md        渲染层与主进程之间冻结的接口契约（通道、返回结构、错误码、事件）
│  └─ 使用说明.md            面向不懂命令行用户的操作手册
│
├─ .work/                    开发脚本的输出目录（生成目录 + 脱敏报告），可随时删
└─ .tools/                   开发脚本使用的插件目录（npm 缓存等），可随时删
```

运行时数据位置：

| 内容 | 桌面程序 | 命令行 |
| --- | --- | --- |
| 生成目录 / 脱敏报告 | `%APPDATA%\设计稿上线助手\workspaces` | `~/design-deployer-workspaces`（或 `--out`） |
| 插件（gh / sharp） | `%APPDATA%\设计稿上线助手\tools` | `DD_TOOLS_DIR` 或 `~/.design-deployer-tools` |

---

## 六、工作原理

### 6.1 三阶段流水线

```
        ┌──────────────┐     ┌──────────────┐     ┌────────────────────┐
设计稿 →│  ①  扫描     │ →   │  ②  决定     │ →   │ ③  生成 / 上线     │ → 网址
        │ scanner.js   │     │ 用户逐项选择 │     │ redactor.js        │
        │ 规则命中     │     │ mask/delete/ │     │ deploy.js          │
        │ 聚合 + 定位  │     │ hideblock/   │     │ git + gh + Pages   │
        └──────────────┘     │ keep         │     └────────────────────┘
                             └──────────────┘
```

- **扫描**是纯读取：产出 `findings`（按值聚合）+ `images` + `largeFiles` + `suggestedExcludes` + `warnings`，不写任何文件。
- **决定**是一张纯数据的映射表：`{ findingId: 'mask'|'delete'|'hideblock'|'keep' }` 与 `{ imageId: 'mask'|'delete'|'keep' }`。界面、命令行 `--interactive`、`--policy` 策略最终都只是生成这张表。
- **生成**是唯一会写文件的一步，且只写工作区里的副本。**上线**只推送生成目录。

三个阶段之间只通过数据传递，所以可以自由组合：GUI 里选一半、命令行里补一半；先 `scan --json` 存下来，手工编辑出决定文件，再 `build --decisions`。

### 6.2 为什么 HTML 安全改写要用状态机，而不是正则

需求里最关键的一句是「生成上线目录时不能把页面改坏」。用 `<[^>]*>` 这类正则做标签匹配，会在下面这些**完全合法**的 HTML 里翻车：

```html
<script>
  if (a < b && c > d) { render('<div class="x">'); }   <!-- 正则会把 a < b && c > d 当成标签 -->
</script>

<style>
  .tip::after { content: "<"; }                        <!-- 属性值里的尖括号 -->
</style>

<p title="比较 1<2 的结果">…</p>                        <!-- 属性值里的尖括号 -->
```

一旦把这些当成标签，脱敏时就会「把标签内部当文本改」或「把文本当标签删」，结果是脚本被截断、样式错乱、页面白屏。所以 `lib/html.js` 实现了一个**带状态的扫描器**：

- 逐字符推进，明确区分 `text` / `tag` / `attr` / `comment` / `doctype` / `rawtext` 六种位置；
- `<script> <style> <textarea> <title>` 的内容整段当作 `rawtext`，内部的 `<` `>` 完全不算标签；
- 找标签结束的 `>` 时会跳过引号内的内容（`findTagEnd`），属性值里的尖括号不会截断标签；
- 反过来，落在 `doctype` / 标签名位置的命中会被**直接丢弃**（例如 KEY 命名巧合），绝不改动标签结构；
- 所有改写都表示成「区间 + 替换文本」的编辑列表，`applyEdits` 按起点**从后往前**应用并跳过重叠区间，因此偏移量永远不会错乱；
- 「整块隐藏」不是删 HTML，而是给元素加 `data-dd-hidden="1"` 再注入一条 CSS —— 这样即使隐藏判断出错，最坏结果也只是多隐藏了一块，而不是把页面结构删坏。

### 6.3 为什么子进程输出走文件重定向，而不是管道

`lib/shell.js` 里所有外部命令（`git` / `gh` / `npm` / `winget` / `tar`）都不用 `child_process.exec` 或 `stdio: 'pipe'`，而是：

1. 在系统临时目录建一个 `out.txt` / `err.txt`，用文件描述符直接作为子进程的 `stdout` / `stderr`；
2. 主进程每 **120 ms** 读一次文件新增的部分，拼成完整输出并逐行触发 `onLine` 回调（实时日志就来自这里）；
3. 结束后再补读一次剩余内容，然后删掉临时目录。

这么做的两个原因：

- **管道在受限环境里会失败**：容器、沙箱、某些杀毒软件策略下无法创建命名管道，`pipe` 会直接 `EPERM`；文件重定向没有这个限制。
- **管道缓冲区会写满**：`npm install` / `git push --progress` 这类命令输出量很大，如果父进程没及时读走，管道缓冲区一满子进程就会卡死。文件没有这个容量上限，即使轮询偶尔慢一拍也不会阻塞子进程。

另外还有几条一致性设计：命令一律用**参数数组**调用（不拼 shell 字符串），避免路径里的空格与中文被转义出错；`.cmd` / `.bat`（`npm.cmd`）才走 `cmd.exe /d /s /c` 并对整条命令行重新加引号，绕开 `cmd` 的引号解析规则；环境里固定注入 `GIT_TERMINAL_PROMPT=0`、`NO_COLOR=1`、`GH_NO_UPDATE_NOTIFIER=1`。

---

## 七、常见问题（FAQ）

### Q1：文件夹里没有 `index.html` 怎么办？

程序仍然可以继续（扫描会提示「未找到 HTML 入口文件」），但 GitHub Pages 访问 `https://<用户名>.github.io/<仓库>/` 时**默认找的就是该目录下的 `index.html`**，没有它就会 404。三种处理方式：

1. 把真正的入口文件改名为 `index.html`（最省事）；
2. 如果入口在子目录里（例如 `dist/index.html`），直接把那个子目录拖进来，或者拖它的父目录让程序自动定位；
3. 保留现状也能上线，此时访问链接要带上具体文件名：`https://<用户名>.github.io/<仓库>/main.html`。

如果目录下有**多个**含 `index.html` 的子目录，程序不会替你猜，会报 `E_BAD_INPUT` 并列出候选，请直接选中其中一个。

### Q2：报 `E_REPO_EXISTS`（仓库已存在）怎么办？

说明 `<你的用户名>/<仓库名>` 在 GitHub 上已经有了。界面上会出现一条确认提示，两个选择：

- 点 **「覆盖推送（reuse: true）」**：复用这个仓库，把新版本强推上去（`git push -u origin HEAD:main --force`）。适合「我要更新自己之前上线的网站」。
- 点 **「换个仓库名」**：清掉 reuse 标记，回到表单改一个没人用过的名字。

选完之后**需要再点一次「开始上线」**才会真正执行。命令行里对应 `--reuse` 参数。

### Q3：为什么提示私有仓库开 Pages 需要付费？

GitHub Pages 对**私有仓库**只对付费账号（Pro / Team / Enterprise）开放。免费账号给私有仓库开 Pages 时接口会返回错误，程序报 `E_PAGES` 并提示「把仓库可见性改成「公开」后重试」。如果你确实需要「源码私有、页面公开」，目前的实现做不到（见「局限」）。

### Q4：点完「开始上线」要等多久？

- 建库 + 推送：小站点十几秒，几百 MB 的站点可能几分钟（超时上限 15 分钟）。
- **Pages 首次构建：通常 1~3 分钟**。程序每 6 秒查一次状态，最多等 **7 分钟**；超时不会失败，只是提前把链接交给你，稍后再刷新即可。
- 强制 HTTPS：最多 6 轮 × 10 秒 ≈ 1 分钟（证书可能还在签发）。
- 线上复核：最多 8 次 × 15 秒 ≈ 2 分钟。
- 所以最坏情况下，一次完整上线可能等 10 分钟左右。界面上的实时日志会一直更新，不用盯着。

### Q5：大文件的 50 MB / 100 MB 限制是怎么回事？

- GitHub 对**单个文件**有硬上限 **100 MB**，超过直接被拒；
- 超过 **50 MB** 的文件上传会很慢，推荐不要放进仓库。

程序默认把 ≥ 50 MB 的文件列进第 3 步的「大文件清单」，勾选即「不上传」，同时会自动把页面里引用该文件的元素摘掉（视频会被整块隐藏，不会留下一个破图）。命令行用 `--exclude`。

### Q6：`.nojekyll` 有什么用？

GitHub Pages 默认会用 Jekyll 处理你推送的内容，而 **Jekyll 会忽略所有以下划线开头的文件和目录**（如 `_backup/`、`_shots/`、`_next/`），也不会拿它们当静态资源返回。放一个空的 `.nojekyll` 文件在站点根目录，就是告诉 Pages「不要用 Jekyll」。（实际上 `.nojekyll` 是「存在即生效」，内容为空即可。）

本程序在**每次生成时都会写一个空的 `.nojekyll`**，所以 `_backup` 这类目录只要没被排除，也会被正常公开访问。反过来说：**如果你的站点真的不想公开 `_backup`，请在扫描结果的「建议排除」里排除它**，而不是指望 Pages 帮你藏起来。

### Q7：界面显示「证书还在签发中」/ HTTPS 强制没开启成功？

这是 GitHub 的正常行为：仓库的 Pages 证书签发需要一点时间，签发完成后才能开启强制跳转。程序会重试 6 次，仍失败时只在日志里留一条 warning，**不影响网站可访问**。稍后可以手动到仓库 `Settings → Pages` 勾选 **Enforce HTTPS**。

### Q8：图片打码插件 sharp 装不上怎么办？

常见原因：网络 / npm 镜像不可达、平台不受支持、npm 不在 PATH 里。

程序不会因此中断：**自动降级为同尺寸 SVG 占位图**——读原图尺寸，生成一张同样宽高的斜纹占位图 `原名.hidden.svg`，删掉原图，并把页面里所有对该图的引用改成新文件名。版式不塌、隐私不泄露，只是看不到「模糊的照片」而已。右侧「环境与插件」面板会把「图片打码插件」标成未安装并显示原因；网络恢复后点「重新检测」会自动再装一次。

### Q9：GitHub 登录一直没成功 / 报 `E_NOT_LOGGED_IN`？

程序会打开一个真实终端窗口执行 `gh auth login --hostname github.com --git-protocol https --web`，然后轮询登录状态，**最多等 5 分钟**，超时返回 `E_NOT_LOGGED_IN`（提示「可以重新点击「登录 GitHub 账号」再试一次」）。排查顺序：

1. 终端窗口是否真的弹出来了？没弹就手动在命令行跑 `gh auth login`；
2. 浏览器是否打开了 GitHub 的设备授权页？需要输入终端里显示的 8 位代码；
3. 授权完成后终端是否提示 `Logged in as <用户名>`；
4. 已登录但界面没刷新 → 点「重新检测登录状态」（或等 20 秒，程序会自动刷新）；
5. 网络受限时可以用备用方案：`docs/使用说明.md` 里的「使用访问令牌登录」，粘贴一个有 `repo` 权限的 Personal Access Token。

### Q10：Pages 链接打开是 404，但仓库里明明有文件？

按可能性排序：

| 原因 | 检查方法 |
| --- | --- |
| 构建还没跑完 | 等 1~3 分钟再刷新；或看仓库 `Actions` 页 |
| 根目录没有 `index.html` | 确认入口文件名，见 Q1 |
| 访问链接拼错 | 项目站点要带仓库名与结尾斜杠：`https://<用户名>.github.io/<仓库>/`；用户站点才是 `https://<用户名>.github.io/` |
| 仓库是私有的 | 免费账号的私有仓库 Pages 根本不会构建，改公开 |
| 忘了 `.nojekyll` 且入口在被忽略的目录里 | 本程序会自动写 `.nojekyll`，若你手工改过生成目录要注意 |
| Pages 的分支 / 目录设置不对 | 程序设的是 `main` 分支、`/` 根目录；手工改过要在仓库 `Settings → Pages` 改回来 |

界面第 5 步的「查看构建日志」按钮会直接打开该仓库的 Actions 页面。

### Q11：会不会修改我的原始设计稿？

不会。扫描是只读的；生成阶段是把站点**复制**到工作区后再改写；上线推送的是复制出来的那份。唯一会写文件的例外是你手动点「打开目录」后自己去改。

### Q12：能否重复上线 / 更新网站？

可以。改完设计稿后重新导入 → 第 2 步重新确认 → 第 3 步重新生成 → 第 4 步填**同一个仓库名**，这时会报 `E_REPO_EXISTS`，点「覆盖推送」即可。程序用 `git push --force` 覆盖 `main` 分支，Pages 会自动重新构建。

### Q13：双击 `启动.bat`，黑窗口一闪就关了 / 程序窗口闪一下就没了？

**先双击 `诊断.bat`**，它会把 Node/npm/Git/gh/登录状态/关键文件/electron 能否运行/启动日志/残留进程全部收集到 `诊断报告.txt` 并自动打开，把这个文件发给开发者即可定位。

这个现象在开发过程中真实出现过一次，根因是**批处理文件编码**：早期版本的 `启动.bat` 用了 `chcp 65001`（切到 UTF-8 代码页）却在 `if (...)` 括号块里写了中文，cmd 会把中文行当成命令去执行，于是脚本在执行到一半时崩掉、根本走不到最后的 `pause`，表现就是"一闪就关"。当时的原始报错长这样：

```
'��。' is not recognized as an internal or external command
The system cannot find the path specified.
```

现已修复，做法是：
1. 三支 `.bat` 全部存成 **GBK（cp936）** 编码 —— 中文 Windows 控制台的原生编码，不再需要 `chcp`；
2. 行尾统一 `CRLF`；
3. 脚本里不再使用含中文的 `if (...)` / `for (...)` 括号块，全部改成 `goto :label` 分支；
4. `启动.bat` **末尾无条件 `pause`**，并在开头就把过程写进 `启动日志.txt`，程序侧 `electron/main.js` 也会把启动每一步、渲染进程崩溃、页面加载失败都追加进同一个日志，并且**任何异常都弹对话框**（不再静默退出）；
5. 单实例锁获取失败时**不再 `app.quit()`**（这是另一个会造成"闪退"的经典原因：有残留实例时新进程直接自杀），改为照常开窗口。

如果诊断报告里显示 `electron.exe` 存在但 `--version` 非 0，通常是杀毒软件拦截或系统缺少 VC++ 运行库；如果报告里根本没有「启动日志」，说明 `启动.bat` 没跑到调用程序那一步，把 `cmd /c 启动.bat` 的完整报错发出来即可。

---

## 八、安全与隐私说明

1. **不向任何第三方上传数据。** 程序对外发起的网络请求只有四类，全部指向 GitHub / npm 官方：`api.github.com`（查询 gh 最新版本、建库、开 Pages、轮询状态）、`github.com`（下载 gh 官方 zip、git push、「打开 Github Pages 帮助」）、`codeload` / release 下载地址（gh 安装包本体）、npm registry（安装 sharp）。没有任何自建服务端、没有遥测、没有统计上报。
2. **敏感值只落在本地工作区。** 扫描结果、决定、生成目录、脱敏报告全部在你自己电脑的 `workspaces` 目录下。推送到 GitHub 的只有生成目录里的站点文件；报告在生成目录的**上一级**，不在推送范围内。
3. **日志与报告里的敏感值做了软打码。** 脱敏报告的「已处理 / 保留未处理 / 自检未通过」三处全部用 `softMask()` 处理过（只留约 1/4 前缀，其余替换成 `*`），因此报告可以放心作为答辩材料。
4. **渲染层没有任何系统权限。** `contextIsolation: true`、`nodeIntegration: false`，界面只能通过 `window.dd` 这一组白名单接口与主进程通信；页面 CSP 是 `default-src 'none'`，`connect-src 'none'`，界面自己不联网。
5. **外部链接一律交给系统浏览器。** 界面里的链接点击后由 `shell.openExternal` 打开，只允许 `http/https`。

> **两点诚实提醒**（当前实现如此，不是设计意图）：
> - 命令行的 `scan` / `build` 会把**原文值**打印到终端（用于核对），所以在共享屏幕、录屏或投屏演示时，请不要在敏感文件夹上直接用 CLI 打印清单；
> - `scan --json` 导出的 JSON 里含有原始值与命中位置，请当作敏感文件保管，不要提交进仓库。

---

## 九、局限与后续可做

**当前没有实现、如实说明**：

| 未实现 | 说明 |
| --- | --- |
| 自定义域名（CNAME） | 代码里没有写 `CNAME` 文件的逻辑，主进程也不会返回 `verify.cname`。想用自己的域名，只能上线后手工到仓库 `Settings → Pages → Custom domain` 配置。 |
| 二维码 | 没有生成二维码的功能，也没有引入任何二维码库。 |
| 多页面站点导航 / 站点地图 | 扫描会**提示**「除入口外还有 N 个 HTML 文件，它们同样会被公开访问」，但不会生成导航页或 `sitemap.xml`。 |
| 私有仓库 + 公开页面 | 免费账号做不到，程序会明确报错让你改公开。 |
| CI / Actions 自动部署 | 程序走的是「本地 git push + 仓库 Pages 从分支构建」，不会生成 `.github/workflows/*.yml`。 |
| 自动语义理解 | 姓名、疑似姓名靠的是姓氏表 + 语境规则，仍可能漏判（例如只有英文名、只有昵称）或误判；「疑似姓名」默认保留就是为此留的人工兜底。 |
| 星号以外的打码样式 | 文本打码是字符替换，不能把文字替换成一条黑条（图片才有真实的模糊处理）。 |

**后续可以做的事**：

1. **自定义域名支持**：生成 `CNAME` 文件并调 `gh api ... /pages` 写入 `cname` 字段。
2. **二维码**：上线成功后把链接渲染成二维码，方便手机扫码查看（可以用 Canvas 自己画，避免引依赖）。
3. **多页面站点**：自动生成入口页 / `sitemap.xml`，或至少把「其它 HTML 文件」也纳入入口检测与链接改写。
4. **CI 自动化**：可选生成 GitHub Actions workflow，把「重新生成 + 推送」搬到云端，本地只保留脱敏这一步。
5. **更强的图片隐私**：人脸自动检测（用于在没有文件名线索时识别人像）、条形码 / 证件号区域模糊。
6. **决定模板**：把一次的决定保存成「策略文件」并复用，适合固定类型的作品集反复上线。

---

## 十、验证记录与已知限制

### 10.1 自动化验证（可复现）

| 命令 | 覆盖范围 | 当前结果 |
| --- | --- | --- |
| `npm run check`（`scripts/check-contract.cjs`） | 主进程 ↔ 预加载脚本的通道对齐、渲染层调用的 `dd.*` 是否真实存在、事件三件套是否两端都接、CSP 是否允许本地图片且不放行远程脚本、界面有无 `innerHTML` 拼接、全部 JS 语法 | **125 项通过 / 0 问题** |
| `npm run smoke`（`scripts/smoke.cjs`） | 环境自检；运行时生成一个**全合成**测试站（不含任何真实个人信息、不依赖本机路径），对其扫描的 16 项断言（含 2 条"不许命中"的误报断言：姓名不误报、学校不把"三届全国大学生广告大赛"当学校）；生成结果 18 项断言（明文是否消失、隐藏样式、空条目整块隐藏、重复属性、排除项、`.nojekyll`、人像打码、自检、报告不留明文）；本地预览服务 7 项断言（200 / Content-Type / 内容 / Range 206 / 404 回退） | **46 项通过 / 0 失败** |
| `npm run test:llm`（`scripts/test-llm.cjs`） | 起一个本地假模型服务器，验证 `lib/llm.js` 的**真实** provider 代码路径：429 指数退避重试、401 立刻抛出且不重试、SSE 流式解析、Anthropic 的 system 拆分与头字段、usage 映射、主备降级切换、缺 key 报错、token 估算与成本计量、key 不泄漏 | **29 项通过 / 0 失败** |
| `npm run scan` / `npm run build:test` | 只跑扫描 / 只跑生成的对照实验，输出人类可读清单，便于人工核对 | 通过 |
| `npm run verify:online`（`scripts/verify-online.cjs`） | 独立复核**真实线上页面**：抓取链接、逐条比对原值是否还在、检查打码与隐藏是否生效 | 对示例站点实测通过 |
| `npm run ui`（`scripts/ui-drive.cjs`） | 用真实 `src/` + 真实 `electron/preload.js`，把五步界面自动走一遍并逐屏截图到 `shots/`（需能启动 Electron 的桌面环境） | 见 10.2 |

### 10.2 一次真实的端到端上线记录

用示例站点（`作品展示网站`，35 个文件 / 161 MB）跑过一次完整链路，作为证据：

```bat
node bin/dd-cli.cjs all "<你的站点目录>" ^
  --policy mask-all --exclude "_backup,_shots,assets/video-demo.mp4,assets/video-extra.mp4" ^
  --out "<工作区目录>" --deploy --repo my-portfolio --reuse
```

| 环节 | 结果 |
| --- | --- |
| 扫描 | 162 处命中 → 归纳为 15 项敏感信息 + 23 张图片（含 1 张人像、13 张带 EXIF、2 个 >50MB 视频） |
| 生成 | 21 个文件 / 27.1 MB；文本改写 22 处、整块隐藏 2 处；自检「没有漏网」通过 |
| 推送 | 覆盖推送到 `disagion06/my-portfolio`（27.1 MB，提交 2567e74） |
| Pages | 开启（main / 根目录）→ 状态 `built` → **强制 HTTPS 已开启** |
| 线上复核 | HTTP 200，核对了 6 个原值，**未发现残留** |
| 独立复核 | `npm run verify:online` → 邮箱/完整手机号/姓名/人像文件名全部消失，`杨**` 与隐藏样式、占位图均已生效 |

上线地址：<https://disagion06.github.io/my-portfolio/>

> 这次实测同时暴露并修好了一个真实环境问题：某些受限环境里 git 的 schannel（Windows 自带 TLS）
> 会报 `AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`，程序现在会按
> 「默认 → OpenSSL TLS 后端 → GitHub CLI 令牌 → 两者组合」自动降级重试，全程不写任何配置文件。

### 10.3 已知限制（如实说明）

1. **图形界面未能在无桌面/受限沙箱环境里截图验证。** `npm run ui` 需要能正常启动 Electron 的桌面会话；在有图形界面的 Windows 上直接双击 `启动.bat` 即可看到真实界面。界面逻辑本身经过契约静态校验（10.1 第一行，125 项）与契约桩驱动的全流程走查（渲染层作者独立完成：20 项断言通过、0 运行时错误），但**真机截图**请在本人电脑上补做，答辩时建议现场演示。
   注：命令行链路（scan → build → deploy → verify）已在真实 GitHub 仓库上完整跑通，见 10.2，界面与命令行共用同一套主进程与 lib 逻辑。
2. **sharp 是可选插件。** 装不上（离线、平台不支持、没有 npm）时会自动降级为「同尺寸 SVG 占位图」，隐私效果等同（原图被删除），但视觉上是马赛克占位块而不是模糊照。这一降级路径已被冒烟测试覆盖。
3. **没有自定义域名与二维码。** 只支持 GitHub Pages 默认域名（`https://用户名.github.io/仓库名/`）；绑定自有域名需要手动改 DNS，脚本不代劳。
4. **不处理视频内部的人脸与语音。** 只处理文本、图片元数据与人像图片本身；视频文件要么原样上传，要么直接排除。
5. **PDF / Office 文件不做内容扫描**，只能整文件排除（会被列入"建议排除"清单）。
6. **首次 Pages 构建需要 1~3 分钟**，程序轮询最多等 7 分钟；超时也会把链接返回，稍后自行打开验证即可。

### 10.4 已修复的历史问题（供答辩"迭代过程"参考）

初版交付后做了一轮逐行交叉核对，发现并修复了以下 8 个问题，均已回归验证：

| # | 问题 | 修复 |
| --- | --- | --- |
| 1 | `package.json` 引用了不存在的 `scripts/chmod-note.cjs`、`scripts/smoke.cjs`，导致 `npm install` 非 0 退出、`启动.bat` 误判"依赖安装失败" | 补齐两个脚本（postinstall 改为只做提示+自检，绝不阻塞安装） |
| 2 | 图形界面上线时**没有把待复核的原值传给主进程**，第 5 步"未发现残留"变成没有依据的结论 | GUI 补传 `forbiddenValues`（来自 `build.applied` 中 `action !== 'keep'` 的原值）与 `reportPath`；`verify` 增加 `checkedValues`，界面文案改为"已核对 N 个原值" |
| 3 | GUI 生成的报告缺少"## 上线信息"章节 | 同上补传 `reportPath` |
| 4 | 第 2 步关于自定义关键词的提示是过期文案 | 改为如实说明（关键词参与脱敏，但不会新增扫描条目） |
| 5 | `docs/IPC_CONTRACT.md` 与实现多处不符（`outParent`/`workDir`、`removedRefs`/`excluded`、`pushedBytes`、`verify.cname` 等） | 契约文档逐条对齐实现；顺手把 `pushedBytes` 真正实现出来，删掉界面里永不渲染的"自定义域名"行 |
| 6 | 报告文件名用 `slice(-6)` 取时分秒，隐含依赖时间戳长度 | 改为直接用输出目录名拼接 |
| 7 | 命令行帮助漏 `hide-all`、`--keywords`、`--keep-exif`、`--report`，且没解释四种策略语义 | 帮助重写，补上策略语义与全部参数 |
| 8 | `loadSharp` 的缓存不区分插件目录，先失败一次就再也不重试 | 缓存改为 `Map<toolsDir, module>` |

---

## 十一、技术栈与许可

| 项 | 值 |
| --- | --- |
| 运行时 | Node.js 内建模块（`fs` / `path` / `http` / `child_process` / `stream` / `crypto`），**零运行时依赖** |
| 桌面外壳 | Electron `^44.7.0`（devDependency） |
| 界面 | 原生 ES2020 + CSS，无框架、无构建步骤 |
| 打包 | electron-builder `^26.15.3`（Windows x64：NSIS 安装包 + 便携版 exe） |
| 按需安装 | GitHub CLI（官方 zip）、sharp（npm，缺省时降级） |
| 许可 | MIT |

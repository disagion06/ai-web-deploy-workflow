@echo off
setlocal
cd /d "%~dp0"
title DesignDeployer-Build

set "LOGFILE=%~dp0打包日志.txt"
echo ------------------------------------------------------------ > "%LOGFILE%"
echo [%date% %time%] 开始打包 >> "%LOGFILE%"

echo ============================================================
echo   打包「设计稿上线助手」
echo   会生成两个文件，都在 dist 目录下：
echo     1. 设计稿上线助手-安装包-x.x.x.exe   带向导的安装程序
echo        （含「创建桌面快捷方式」勾选框，可自选安装目录）
echo     2. 设计稿上线助手-便携版-x.x.x.exe   免安装，双击即用
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

set "npm_config_cache=%~dp0.npmcache"
rem 把 electron-builder 的下载缓存放到程序目录，避免往系统目录写
set "ELECTRON_BUILDER_CACHE=%~dp0.builder-cache"
rem 国内直连 GitHub 会超时，固定使用 npmmirror 镜像（交接文档第 7 节记的坑）
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

if not exist "node_modules\electron\package.json" goto :install
if not exist "node_modules\electron-builder\package.json" goto :install
goto :icon

:install
echo [信息] 正在安装依赖（需要联网，约 1~3 分钟）...
call npm install --no-audit --no-fund >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :install_fail
goto :icon

:icon
echo [信息] 生成程序图标...
call node scripts\make-icon.cjs >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :build_fail

:build
echo.
echo [信息] 开始打包（首次会下载 Electron 运行库与 NSIS 工具链，约 100~200MB，请耐心等待）...
echo.
call npx electron-builder --win nsis portable >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :build_fail

echo.
echo [完成] 打包成功！产物已打开所在目录。
start "" "%~dp0dist"
goto :end

:no_node
echo [错误] 没有检测到 Node.js，请先到 https://nodejs.org 安装。
goto :end

:install_fail
echo [错误] 依赖安装失败，详情见「打包日志.txt」。
goto :end

:build_fail
echo [错误] 打包失败，详情见「打包日志.txt」。
echo        常见原因：网络下载 Electron / NSIS 超时。
echo        已固定使用 npmmirror 镜像；如仍失败可手动改 ELECTRON_MIRROR 换源：
echo          set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo          set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
goto :end

:end
echo.
echo 本窗口不会自动关闭，按任意键退出。
pause >nul
endlocal

@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title DesignDeployer

set "LOGFILE=%~dp0启动日志.txt"
echo ------------------------------------------------------------ > "%LOGFILE%"
echo [%date% %time%] 启动脚本开始 >> "%LOGFILE%"
echo 当前目录：%CD% >> "%LOGFILE%"

echo ============================================================
echo            设计稿上线助手 · DesignDeployer
echo   把本地设计稿脱敏后一键上线到 GitHub Pages
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [信息] Node.js %NODEV%
echo [信息] Node.js %NODEV% >> "%LOGFILE%"

set "npm_config_cache=%~dp0.npmcache"
set "npm_config_audit=false"
set "npm_config_fund=false"

if not exist "node_modules\electron\package.json" goto :need_install
goto :run_app

:need_install
echo.
echo [信息] 首次运行，正在安装运行依赖（需要联网，约 1~3 分钟）...
echo [信息] 开始 npm install >> "%LOGFILE%"
call npm install --no-audit --no-fund >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :install_fail
goto :run_app

:run_app
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" goto :run_npx

echo.
echo [信息] 正在启动界面...
echo [信息] 直接调用 electron.exe >> "%LOGFILE%"
"%ELECTRON_EXE%" . --enable-logging >> "%LOGFILE%" 2>&1
set "RC=!errorlevel!"
goto :after_run

:run_npx
echo.
echo [信息] 未找到 electron 运行库，改用 npx 启动...
echo [信息] electron.exe 不存在，回退到 npx >> "%LOGFILE%"
call npx electron . --enable-logging >> "%LOGFILE%" 2>&1
set "RC=!errorlevel!"
goto :after_run

:after_run
echo.
echo [信息] 程序已退出，返回码 !RC! （0 表示正常关闭）
echo [%date% %time%] 退出，返回码 !RC! >> "%LOGFILE%"
if not "!RC!"=="0" goto :bad_exit

echo        如果你并没有主动关闭窗口，而它自己一闪就没了，
echo        请把本目录下的「启动日志.txt」发给开发者，里面有完整原因。
goto :end

:bad_exit
echo.
echo [错误] 程序异常退出，返回码 !RC!。
echo        请把本目录下的「启动日志.txt」发给开发者，里面有完整原因。
goto :end

:install_fail
echo.
echo [错误] 依赖安装失败，详情见「启动日志.txt」。
goto :end

:no_node
echo [错误] 没有检测到 Node.js。
echo        请到 https://nodejs.org 安装 LTS 版本（安装时保持默认勾选），
echo        装好后重新双击本文件。
echo [错误] 未检测到 node >> "%LOGFILE%"
goto :end

:end
echo.
echo ============================================================
echo  本窗口不会自动关闭，按任意键退出。
echo ============================================================
pause >nul
endlocal

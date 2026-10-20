@echo off
setlocal
cd /d "%~dp0"
title DesignDeployer-Diagnose

set "REPORT=%~dp0诊断报告.txt"
echo 设计稿上线助手 · 环境诊断 > "%REPORT%"
echo 生成时间：%date% %time% >> "%REPORT%"
echo ============================================================ >> "%REPORT%"

echo.
echo 正在收集信息，请稍候（约 10 秒）...
echo.

call :run "系统版本" "ver"
call :run "当前目录" "cd"
call :run "Node" "node -v"
call :run "npm" "npm -v"
call :run "Git" "git --version"
call :run "GitHub CLI" "gh --version"
call :run "GitHub 登录状态" "gh auth status"
call :run "Git 凭据助手配置" "git config --global --get-regexp credential"

echo. >> "%REPORT%"
echo ---- 关键文件是否齐全 ---- >> "%REPORT%"
for %%F in ("package.json" "electron\main.js" "electron\preload.js" "src\index.html" "src\app.js" "src\styles.css" "node_modules\electron\package.json" "node_modules\electron\path.txt" "node_modules\electron\dist\electron.exe") do call :checkfile "%%~F"

echo. >> "%REPORT%"
echo ---- electron.exe 能否运行 ---- >> "%REPORT%"
if not exist "node_modules\electron\dist\electron.exe" goto :noexe
call :run "electron --version" "node_modules\electron\dist\electron.exe --version"
goto :logs

:noexe
echo 找不到 electron.exe，无法测试 >> "%REPORT%"

:logs
echo. >> "%REPORT%"
echo ---- 启动日志 ---- >> "%REPORT%"
if not exist "启动日志.txt" goto :nolog
type "启动日志.txt" >> "%REPORT%"
goto :procs

:nolog
echo 还没有「启动日志.txt」，说明 启动.bat 可能根本没跑到程序这一步。 >> "%REPORT%"

:procs
echo. >> "%REPORT%"
echo ---- 残留的 electron 进程 ---- >> "%REPORT%"
tasklist /FI "IMAGENAME eq electron.exe" >> "%REPORT%" 2>&1

echo.
echo ============================================================
echo  诊断完成，报告已保存到：%REPORT%
echo  请把这个文件的内容发给开发者。
echo ============================================================
echo.
start "" notepad "%REPORT%" 2>nul
pause
endlocal
goto :eof

:run
echo. >> "%REPORT%"
echo ---- %~1 ---- >> "%REPORT%"
call %~2 >> "%REPORT%" 2>&1
echo 退出码=%errorlevel% >> "%REPORT%"
echo   [已收集] %~1
goto :eof

:checkfile
if not exist "%~1" goto :missing
echo [存在] %~1 >> "%REPORT%"
goto :eof

:missing
echo [缺失] %~1 >> "%REPORT%"
goto :eof

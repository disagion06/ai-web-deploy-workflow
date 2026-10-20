; ============================================================================
;  设计稿上线助手 · NSIS 安装包自定义脚本
;  由 electron-builder 的 "nsis.include" 引入。编译时带 -INPUTCHARSET UTF8，
;  所以本文件用 UTF-8 直接写中文即可。
;
;  这里只做一件事：在「选择安装目录」之后插入一个安装选项页，
;  让用户自己勾选「是否创建桌面快捷方式」。
;
;  为什么不用 electron-builder 的 createDesktopShortcut 开关：
;  那个开关只有「总是创建 / 从不创建」两种，没有让用户选择的余地。
;  所以 package.json 里把它设为 false，改由本脚本按用户勾选来创建、
;  并在卸载时负责清理（否则桌面上会留下指向已删除程序的死链接）。
;
;  ── 三个必须注意的坑（都是踩过才知道的）──────────────────────────────
;  1. 本文件被注入的位置在主模板最前面，比 !include "MUI2.nsh" 还早，
;     所以用到 MUI 宏就得自己先 !include "MUI2.nsh"（它有 include 保护，重复无副作用）。
;  2. electron-builder 会编译两遍脚本：第一遍带 BUILD_UNINSTALLER（生成卸载器）。
;     assistedInstaller.nsh 把「页面声明区」整个包在 !ifndef BUILD_UNINSTALLER 里，
;     因此那一遍不会展开 customPageAfterChangeDir、也不会引用这里的函数和变量。
;     函数/变量如果不加同样的守卫，NSIS 会报 warning 6010 / 6001，
;     而 electron-builder 默认「警告即错误」，打包直接失败。
;  3. $newDesktopLink 由 common.nsh 的 setLinkVars 按 SHORTCUT_NAME 算好，
;     安装上下文和卸载上下文里都可用，直接复用即可（不要自己拼中文路径，
;     免得踩脚本编码的坑）。
; ============================================================================

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "MUI2.nsh"

!ifndef BUILD_UNINSTALLER

Var DesignDeployerDesktopCheckbox
Var DesignDeployerDesktopState

; ------------------------------------------------------------------ 安装选项页
; 挂载点：assistedInstaller.nsh 在 MUI_PAGE_DIRECTORY 之后、MUI_PAGE_INSTFILES 之前
; 会 !insertmacro customPageAfterChangeDir，所以宏体内直接写 Page 声明即可。
!macro customPageAfterChangeDir
  Page custom DesignDeployerOptionsCreate DesignDeployerOptionsLeave
!macroend

Function DesignDeployerOptionsCreate
  !ifmacrodef MUI_HEADER_TEXT
    !insertmacro MUI_HEADER_TEXT "安装选项" "选择安装完成后要创建的快捷方式"
  !endif

  nsDialogs::Create 1018
  Pop $R0
  ${If} $R0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 22u "开始菜单里会创建「设计稿上线助手」的快捷方式。$\r$\n你还可以在桌面上也放一个，方便随时双击打开："
  Pop $R0

  ${NSD_CreateCheckbox} 0 32u 100% 12u "创建桌面快捷方式（推荐）"
  Pop $DesignDeployerDesktopCheckbox
  ${NSD_SetState} $DesignDeployerDesktopCheckbox ${BST_CHECKED}

  ${NSD_CreateLabel} 0 52u 100% 26u "取消勾选也可以：安装完成后在开始菜单里找到程序，右键 →「发送到」→「桌面快捷方式」。$\r$\n卸载时程序会自动清理桌面上的快捷方式。"
  Pop $R0

  nsDialogs::Show
FunctionEnd

Function DesignDeployerOptionsLeave
  ${NSD_GetState} $DesignDeployerDesktopCheckbox $DesignDeployerDesktopState
  ; 为什么不直接把这个变量带到安装阶段：
  ; 选「为所有用户安装」时安装器会通过 UAC 再启动一个提权实例，
  ; 内外两个实例的 NSIS 变量是不共享的，勾选状态会丢。
  ; 所以落到 HKCU（同一用户的提权实例也读得到），安装阶段再取回来。
  ${If} $DesignDeployerDesktopState == ${BST_CHECKED}
    WriteRegStr HKCU "Software\DesignDeployer" "DesktopShortcut" "1"
  ${Else}
    WriteRegStr HKCU "Software\DesignDeployer" "DesktopShortcut" "0"
  ${EndIf}
FunctionEnd

!endif ; BUILD_UNINSTALLER

; ------------------------------------------------------------------ 安装时
; 挂载点：installSection.nsh 在快捷方式、注册表都写好之后调用 customInstall，
; 此时 $appExe（主程序路径）与 $newDesktopLink（桌面快捷方式路径）都已就绪。
!macro customInstall
  ReadRegStr $R1 HKCU "Software\DesignDeployer" "DesktopShortcut"
  ; 取不到（静默安装 /S、或页面被提权实例跳过）时按「创建」处理
  ${If} $R1 != "0"
    StrCpy $R1 "1"
  ${EndIf}

  ${If} $R1 == "1"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    DetailPrint "已创建桌面快捷方式：$newDesktopLink"
  ${Else}
    ; 用户不要桌面快捷方式：顺手清掉同名残留（例如上一次安装留下的）
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    ClearErrors
    DetailPrint "按用户选择，未创建桌面快捷方式"
  ${EndIf}
!macroend

; ------------------------------------------------------------------ 卸载时
; 因为 package.json 里 createDesktopShortcut=false，electron-builder 自带的卸载流程
; 不会删桌面快捷方式（它用 !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT 判断），必须自己删，
; 否则用户桌面上会留下一个指向已删除程序的死链接。
!macro customUnInstall
  WinShell::UninstShortcut "$newDesktopLink"
  Delete "$newDesktopLink"
  ClearErrors
  DeleteRegKey HKCU "Software\DesignDeployer"
!macroend

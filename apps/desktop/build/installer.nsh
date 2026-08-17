!macro customInit
  ${if} ${isUpdated}
    DetailPrint "Closing the legacy OpenAlice process tree before update."
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /F /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $0
    DetailPrint "Closing remaining processes launched from the OpenAlice install directory."
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance -ClassName Win32_Process | Where-Object {$$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase)} | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Sleep 1000

    ; Releases before 0.89 were unpacked (asar=false) and can contain paths
    ; beyond the legacy MAX_PATH limit. Their NSIS uninstaller repeatedly
    ; fails while atomically renaming that tree. cmd's extended-length path
    ; removes the app directory without touching Electron/OpenAlice user data,
    ; which lives outside $INSTDIR. Clear only the old uninstall commands so
    ; electron-builder skips launching the incompatible legacy uninstaller;
    ; the candidate writes fresh uninstall metadata after extraction.
    DetailPrint "Removing the legacy OpenAlice app directory with long-path support."
    ; The app/installer may inherit $INSTDIR as its working directory. Move out
    ; first because cmd refuses to remove the current directory.
    SetOutPath "$TEMP"
    nsExec::ExecToLog '"$SYSDIR\cmd.exe" /D /C RD /S /Q "\\?\$INSTDIR"'
    Pop $0
    ${if} $0 != 0
      DetailPrint "Unable to remove the legacy OpenAlice app directory (exit $0)."
      SetErrorLevel 2
      Quit
    ${endif}
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
  ${endif}
!macroend

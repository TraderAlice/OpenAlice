!macro customInit
  ${if} ${isUpdated}
    DetailPrint "Closing the legacy OpenAlice process tree before update."
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /F /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $0
    DetailPrint "Closing remaining processes launched from the OpenAlice install directory."
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance -ClassName Win32_Process | Where-Object {$$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase)} | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Sleep 1000
  ${endif}
!macroend

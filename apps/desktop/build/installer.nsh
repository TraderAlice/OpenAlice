!macro customInit
  ${if} ${isUpdated}
    DetailPrint "Closing the legacy OpenAlice process tree before update."
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /F /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $0
    Sleep 1000
  ${endif}
!macroend

; PowerShell helpers are written to $PLUGINSDIR at run time. NSIS strings are
; length-limited and `$`, `"` and `${}` all need escaping, so keep each helper
; one FileWrite per line and use single-quoted PowerShell string literals.

; Stops every process whose executable lives under the install directory and
; waits for the process list to drain instead of sleeping a fixed second.
; Exit code: number of processes still alive at the deadline.
!macro writeStopInstallProcessesScript PATH
  FileOpen $R9 "${PATH}" w
  FileWrite $R9 "param([string]$$Root, [int]$$TimeoutSeconds = 20)$\r$\n"
  FileWrite $R9 "$$deadline = [DateTime]::UtcNow.AddSeconds($$TimeoutSeconds)$\r$\n"
  FileWrite $R9 "$$running = @()$\r$\n"
  FileWrite $R9 "do {$\r$\n"
  FileWrite $R9 "  $$running = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$Root, [System.StringComparison]::OrdinalIgnoreCase) })$\r$\n"
  FileWrite $R9 "  foreach ($$p in $$running) { Stop-Process -Id $$p.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n"
  FileWrite $R9 "  if ($$running.Count -eq 0) { break }$\r$\n"
  FileWrite $R9 "  Start-Sleep -Milliseconds 250$\r$\n"
  FileWrite $R9 "} while ([DateTime]::UtcNow -lt $$deadline)$\r$\n"
  FileWrite $R9 "foreach ($$p in $$running) { Write-Output ('still running: ' + $$p.ProcessId + ' ' + $$p.ExecutablePath) }$\r$\n"
  FileWrite $R9 "exit $$running.Count$\r$\n"
  FileClose $R9
!macroend

; Compares the installed resources tree with the inventory that
; scripts/desktop-after-pack.mjs wrote beside app.asar. Windows PowerShell's
; ConvertFrom-Json caps input near 2 MB, so the inventory is parsed with the
; underlying serializer and an explicit limit. Exit code: 0 complete,
; 1 missing/truncated files, 2 inventory unreadable.
!macro writeVerifyInstallScript PATH
  FileOpen $R9 "${PATH}" w
  FileWrite $R9 "param([string]$$Root)$\r$\n"
  FileWrite $R9 "$$manifest = Join-Path $$Root 'openalice-integrity.json'$\r$\n"
  FileWrite $R9 "if (-not [System.IO.File]::Exists($$manifest)) { Write-Output 'inventory missing: openalice-integrity.json'; exit 2 }$\r$\n"
  FileWrite $R9 "$$data = $$null$\r$\n"
  FileWrite $R9 "try {$\r$\n"
  FileWrite $R9 "  Add-Type -AssemblyName System.Web.Extensions$\r$\n"
  FileWrite $R9 "  $$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer$\r$\n"
  FileWrite $R9 "  $$serializer.MaxJsonLength = [int]::MaxValue$\r$\n"
  FileWrite $R9 "  $$data = $$serializer.DeserializeObject([System.IO.File]::ReadAllText($$manifest))$\r$\n"
  FileWrite $R9 "} catch {$\r$\n"
  FileWrite $R9 "  try { $$data = [System.IO.File]::ReadAllText($$manifest) | ConvertFrom-Json } catch { Write-Output ('inventory unreadable: ' + $$_.Exception.Message); exit 2 }$\r$\n"
  FileWrite $R9 "}$\r$\n"
  FileWrite $R9 "$$files = @($$data.files)$\r$\n"
  FileWrite $R9 "$$bad = 0$\r$\n"
  FileWrite $R9 "foreach ($$entry in $$files) {$\r$\n"
  FileWrite $R9 "  $$ok = $$false$\r$\n"
  FileWrite $R9 "  try {$\r$\n"
  FileWrite $R9 "    $$info = New-Object System.IO.FileInfo (Join-Path $$Root ([string]$$entry[0]))$\r$\n"
  FileWrite $R9 "    $$ok = $$info.Exists -and ($$null -eq $$entry[1] -or $$info.Length -eq [int64]$$entry[1])$\r$\n"
  FileWrite $R9 "  } catch { $$ok = $$false }$\r$\n"
  FileWrite $R9 "  if (-not $$ok) {$\r$\n"
  FileWrite $R9 "    $$bad++$\r$\n"
  FileWrite $R9 "    if ($$bad -le 5) { Write-Output ([string]$$entry[0]) }$\r$\n"
  FileWrite $R9 "  }$\r$\n"
  FileWrite $R9 "}$\r$\n"
  FileWrite $R9 "Write-Output ('checked ' + $$files.Count + ' files, problems ' + $$bad)$\r$\n"
  FileWrite $R9 "if ($$bad -gt 0) { exit 1 }$\r$\n"
  FileWrite $R9 "exit 0$\r$\n"
  FileClose $R9
!macroend

!macro customInit
  ${if} ${isUpdated}
    InitPluginsDir
    DetailPrint "Closing the legacy OpenAlice process tree before update."
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /T /F /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $0
    ; Guardian children (UTA, Workspace CLIs, managed Node/Git) can outlive the
    ; Electron tree briefly. Extracting while they hold handles open leaves a
    ; partial install, so wait for the process list under $INSTDIR to drain.
    DetailPrint "Closing remaining processes launched from the OpenAlice install directory."
    !insertmacro writeStopInstallProcessesScript "$PLUGINSDIR\openalice-stop-install-processes.ps1"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\openalice-stop-install-processes.ps1" -Root "$INSTDIR"'
    Pop $0
    ${if} $0 != 0
      DetailPrint "Processes from the OpenAlice install directory are still running (count $0)."
    ${endif}

    ; Legacy non-ASAR releases and external runtime payloads can contain paths
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

; Runs after extraction and before electron-builder's force-run/finish launch.
; electron-builder's extraction falls back to a non-atomic 7z extract that
; ignores per-file errors, so a locked or long path can otherwise ship a
; partial tree that only fails at first launch. Refuse to hand off to the app.
!macro customInstall
  DetailPrint "Verifying the installed OpenAlice files."
  !insertmacro writeVerifyInstallScript "$PLUGINSDIR\openalice-verify-install.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\openalice-verify-install.ps1" -Root "$INSTDIR\resources"'
  Pop $0
  Pop $1
  ${if} $0 != 0
    DetailPrint "OpenAlice install verification failed (exit $0)."
    DetailPrint "$1"
    MessageBox MB_OK|MB_ICONSTOP "OpenAlice was not installed completely.$\r$\n$\r$\nFiles are missing or truncated under:$\r$\n$INSTDIR$\r$\n$\r$\nClose OpenAlice and any program scanning that folder, then run this installer again. Your OpenAlice data is not affected.$\r$\n$\r$\n$1" /SD IDOK
    SetErrorLevel 3
    Abort "OpenAlice was not installed completely."
  ${endif}
  DetailPrint "OpenAlice install verified: $1"
!macroend

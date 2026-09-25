[CmdletBinding()]
param(
  [ValidateSet('Prepare', 'Switch', 'Run', 'Status')]
  [string]$Mode = 'Switch',
  [string]$Root,
  [string]$DataHome,
  [string]$TaskName = 'OpenAliceServer',
  [int]$WebPort = 47332,
  [int]$McpPort = 47333,
  [int]$UiPort = 5173,
  [int]$WaitSeconds = 120,
  [string]$NodePath,
  [int]$UtaPort = 47334,
  [switch]$DisableAuth,
  [switch]$Lite,
  [switch]$NoInstall,
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path -LiteralPath $Root).Path
$stateDir = Join-Path $Root '.openalice-source-dev'
$logPath = Join-Path $stateDir 'stages.jsonl'
$stampPath = Join-Path $stateDir 'install-stamp.json'
$taskBackupPath = Join-Path $stateDir 'previous-task.xml'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Write-Stage([string]$Name, [scriptblock]$Action) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    & $Action
    $watch.Stop()
    $row = [ordered]@{ timestamp = [DateTime]::UtcNow.ToString('o'); stage = $Name; status = 'pass'; elapsedMs = $watch.ElapsedMilliseconds }
    ($row | ConvertTo-Json -Compress) | Add-Content -LiteralPath $logPath
    Write-Host ('[source-dev] {0} OK ({1} ms)' -f $Name, $watch.ElapsedMilliseconds)
  } catch {
    $watch.Stop()
    $row = [ordered]@{ timestamp = [DateTime]::UtcNow.ToString('o'); stage = $Name; status = 'fail'; elapsedMs = $watch.ElapsedMilliseconds; error = $_.Exception.Message }
    ($row | ConvertTo-Json -Compress) | Add-Content -LiteralPath $logPath
    Write-Error ('[source-dev] {0} FAILED after {1} ms: {2}' -f $Name, $watch.ElapsedMilliseconds, $_.Exception.Message)
    throw
  }
}

$pnpmPath = $null
function Invoke-Pnpm([string[]]$CommandArgs) {
  & $script:pnpmPath @CommandArgs
  if ($LASTEXITCODE -ne 0) { throw ('pnpm exited with code {0}: {1}' -f $LASTEXITCODE, ($CommandArgs -join ' ')) }
}

function Resolve-PnpmPath {
  $command = Get-Command pnpm.CMD -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command pnpm -ErrorAction SilentlyContinue }
  if (-not $command) { throw 'pnpm was not found; install the pinned package manager first' }
  return $command.Source
}

function Resolve-NodePath {
  if ($NodePath) {
    if (-not (Test-Path -LiteralPath $NodePath)) { throw "Node executable not found: $NodePath" }
    return (Resolve-Path -LiteralPath $NodePath).Path
  }
  $candidates = @()
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates += $command.Source }
  $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
  $candidates += (Join-Path $env:ProgramFiles 'vm4w\nodejs\node.exe')
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw 'node.exe was not found; pass -NodePath with the pinned Node executable'
}

function Read-InstallStamp {
  if (-not (Test-Path -LiteralPath $stampPath)) { return $null }
  try { return Get-Content -Raw -LiteralPath $stampPath | ConvertFrom-Json } catch { return $null }
}

function Get-SourceProcesses {
  $rootNeedle = $Root.TrimEnd('\')
  return @(Get-CimInstance Win32_Process | Where-Object {
    if ($_.ProcessId -eq $PID -or -not $_.CommandLine -or $_.CommandLine.IndexOf($rootNeedle, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    $line = $_.CommandLine
    return ($line -match '(?i)scripts[\\/]guardian[\\/]dev\.ts' -or
      $line -match '(?i)src[\\/]main\.ts' -or
      $line -match '(?i)start-source-stack\.ps1' -or
      $line -match '(?i)run-source-vite\.ps1' -or
      $line -match '(?i)windows-source-dev\.ps1.*-Mode\s+Run')
  })
}

function Stop-SourceProcesses {
  $processes = Get-SourceProcesses
  foreach ($process in $processes) {
    try { & taskkill.exe /PID $process.ProcessId /T /F *> $null } catch { }
  }
  Start-Sleep -Milliseconds 500
  $remaining = Get-SourceProcesses
  if ($remaining.Count -gt 0) {
    throw ('source runtime processes still alive: ' + (($remaining | ForEach-Object { $_.ProcessId }) -join ', '))
  }
}

function Assert-PortsFree([int[]]$Ports) {
  foreach ($port in $Ports) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
      throw ('port {0} is still listening after stop: {1}' -f $port, (($listeners | ForEach-Object { $_.OwningProcess }) -join ', '))
    }
  }
}
function Wait-Http([string]$Uri, [int]$TimeoutSeconds, [System.Diagnostics.Process]$Process = $null) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Process -and $Process.HasExited) { throw "child process exited with code $($Process.ExitCode) before $Uri became ready" }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 3
      if ($response.StatusCode -eq 200) { return $response }
    } catch { }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for $Uri"
}

function Wait-SourceVersion([int]$Port, [int]$TimeoutSeconds, [System.Diagnostics.Process]$Process = $null) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $uri = "http://127.0.0.1:$Port/api/version"
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Process -and $Process.HasExited) { throw "Alice exited with code $($Process.ExitCode) before source version became ready" }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        $body = $response.Content | ConvertFrom-Json
        if ($body.channel -eq 'dev' -and $body.updateAuthority -eq 'source') { return $body }
      }
    } catch { }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for source version at $uri"
}

function Wait-UtaHealth([int]$Port, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $uri = "http://127.0.0.1:$Port/__uta/health"
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        $body = $response.Content | ConvertFrom-Json
        if ($body.ok -eq $true) { return $body }
      }
    } catch { }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for UTA health at $uri"
}

function Test-Http200([string]$Uri) {
  try { return (Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}

function Start-SourceTask([int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Min($TimeoutSeconds, 15))
  $attempt = 0
  $lastError = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($task.State.ToString() -eq 'Running') { return }
    if ($attempt -lt 3) {
      try { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch { $lastError = $_.Exception.Message }
      $attempt++
    }
    Start-Sleep -Milliseconds 500
  }
  throw ('scheduled task did not enter Running state; attempts={0}; lastError={1}' -f $attempt, $lastError)
}

function Restore-PreviousTask {
  try { Stop-SourceProcesses } catch { Write-Warning ('[source-dev] failed runtime cleanup during rollback: {0}' -f $_.Exception.Message) }
  if (Test-Path -LiteralPath $taskBackupPath) {
    $xml = Get-Content -Raw -LiteralPath $taskBackupPath
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
    if ($previousTaskWasRunning) { Start-ScheduledTask -TaskName $TaskName }
    Write-Warning '[source-dev] previous scheduled task restored'
  } else {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Warning '[source-dev] failed task registration removed; no previous task existed'
  }
}

switch ($Mode) {
  'Status' {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    [ordered]@{
      task = if ($task) { $task.State.ToString() } else { 'missing' }
      root = $Root
      web = "http://127.0.0.1:$WebPort"
      uta = "http://127.0.0.1:$UtaPort/__uta/health"
      ui = "http://127.0.0.1:$UiPort"
      webReady = Test-Http200 "http://127.0.0.1:$WebPort/api/version"
      uiReady = Test-Http200 "http://127.0.0.1:$UiPort/"
      utaReady = Test-Http200 "http://127.0.0.1:$UtaPort/__uta/health"
      installStamp = Test-Path -LiteralPath $stampPath
      stageLog = $logPath
      recentStages = if (Test-Path -LiteralPath $logPath) { @(Get-Content -Tail 8 -LiteralPath $logPath) } else { @() }
    } | ConvertTo-Json -Compress
    break
  }
  'Prepare' {
    Set-Location -LiteralPath $Root
    $lockPath = Join-Path $Root 'pnpm-lock.yaml'
    if (-not (Test-Path -LiteralPath $lockPath)) { throw "pnpm-lock.yaml not found under $Root" }
    $lockHash = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
    $stamp = Read-InstallStamp
    $installNeeded = -not (Test-Path -LiteralPath (Join-Path $Root 'node_modules')) -or -not $stamp -or $stamp.lockHash -ne $lockHash
    $buildNeeded = $installNeeded -or -not (Test-Path -LiteralPath (Join-Path $Root 'packages\connector-protocol\dist\index.js'))
    $needsPnpm = ($installNeeded -and -not $NoInstall) -or ($buildNeeded -and -not $NoBuild)
    if ($needsPnpm) { $script:pnpmPath = Resolve-PnpmPath }
    if ($installNeeded -and -not $NoInstall) {
      Write-Stage 'install' { Invoke-Pnpm @('install', '--frozen-lockfile', '--filter=!@traderalice/desktop') }
    } elseif ($installNeeded) {
      throw 'dependencies are missing or stale; rerun without -NoInstall'
    } else {
      Write-Host '[source-dev] install SKIP (lockfile stamp matches)'
    }
    $connectorDist = Join-Path $Root 'packages\connector-protocol\dist\index.js'
    if ($buildNeeded -and -not $NoBuild) {
      Write-Stage 'build-server' { Invoke-Pnpm @('build:server') }
    } elseif ($buildNeeded) {
      throw 'generated workspace outputs are missing; rerun without -NoBuild'
    } else {
      Write-Host '[source-dev] build SKIP (workspace outputs present)'
    }
    $resolvedNodePath = Resolve-NodePath
    [ordered]@{ lockHash = $lockHash; node = (& $resolvedNodePath --version); preparedAt = [DateTime]::UtcNow.ToString('o') } |
      ConvertTo-Json | Set-Content -LiteralPath $stampPath
    break
  }
  'Run' {
    $runtimeLog = Join-Path $stateDir 'runtime.log'
    $alice = $null
    $vite = $null
    function Stop-SourceChild([System.Diagnostics.Process]$Process) {
      if ($Process -and -not $Process.HasExited) {
        try { & taskkill.exe /PID $Process.Id /T /F *> $null } catch { }
      }
    }
    try {
      Set-Location -LiteralPath $Root
      $resolvedNodePath = Resolve-NodePath
      $tsxPath = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
      $alicePath = Join-Path $Root 'src\main.ts'
      $pnpmPath = Resolve-PnpmPath
      if (-not (Test-Path -LiteralPath $tsxPath)) { throw "tsx CLI not found: $tsxPath" }
      if (-not (Test-Path -LiteralPath $alicePath)) { throw "Alice entrypoint not found: $alicePath" }
      if ($DataHome) { $env:OPENALICE_HOME = $DataHome }
      $env:NODE_OPTIONS = '--conditions=openalice-source'
      $env:OPENALICE_BACKEND_HOT_RELOAD = '0'
      $env:OPENALICE_LAUNCHER = 'dev'
      $env:OPENALICE_WEB_PORT = [string]$WebPort
      $env:OPENALICE_BACKEND_PORT = [string]$WebPort
      $env:OPENALICE_MCP_PORT = [string]$McpPort
      $env:OPENALICE_TOOL_BASE_URL = "http://127.0.0.1:$McpPort/cli"
      $env:OPENALICE_UTA_PORT = [string]$UtaPort
      $env:OPENALICE_UTA_URL = "http://127.0.0.1:$UtaPort"
      $env:OPENALICE_CONNECTOR_PORT = [string]($McpPort + 2)
      $env:OPENALICE_CONNECTOR_URL = "http://127.0.0.1:$($McpPort + 2)"
      $env:OPENALICE_UI_PORT = [string]$UiPort
      $nodeDir = Split-Path -Parent $resolvedNodePath
      $localBinDir = Join-Path $Root 'node_modules\.bin'
      $env:PATH = ($localBinDir + ';' + $nodeDir + ';' + $env:PATH)
      if ($DisableAuth) { $env:OPENALICE_DISABLE_AUTH = '1' } else { Remove-Item Env:OPENALICE_DISABLE_AUTH -ErrorAction SilentlyContinue }
      if ($Lite) { $env:OPENALICE_LITE_MODE = '1' } else { Remove-Item Env:OPENALICE_LITE_MODE -ErrorAction SilentlyContinue }

      $aliceLog = Join-Path $stateDir 'alice.log'
      $aliceErr = Join-Path $stateDir 'alice.err'
      $viteLog = Join-Path $stateDir 'vite.log'
      $viteErr = Join-Path $stateDir 'vite.err'
      Remove-Item $aliceLog,$aliceErr,$viteLog,$viteErr -Force -ErrorAction SilentlyContinue
      Add-Content -LiteralPath $runtimeLog -Value ('START ' + [DateTime]::UtcNow.ToString('o'))
      Add-Content -LiteralPath $runtimeLog -Value ('CONFIG web=' + $WebPort + ' mcp=' + $McpPort + ' ui=' + $UiPort + ' lite=' + $Lite)

      $alice = Start-Process -FilePath $resolvedNodePath -ArgumentList @($tsxPath, $alicePath) -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $aliceLog -RedirectStandardError $aliceErr -PassThru
      Add-Content -LiteralPath $runtimeLog -Value ('ALICE_PID ' + $alice.Id)
      $version = Wait-SourceVersion $WebPort $WaitSeconds $alice
      Add-Content -LiteralPath $runtimeLog -Value ('ALICE_READY ' + [DateTime]::UtcNow.ToString('o'))

      $vite = Start-Process -FilePath $pnpmPath -ArgumentList @('--filter', 'open-alice-ui', 'dev') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $viteLog -RedirectStandardError $viteErr -PassThru
      Add-Content -LiteralPath $runtimeLog -Value ('VITE_PID ' + $vite.Id)
      Wait-Http "http://127.0.0.1:$UiPort/" $WaitSeconds $vite | Out-Null
      Add-Content -LiteralPath $runtimeLog -Value ('READY ' + [DateTime]::UtcNow.ToString('o') + ' version=' + ($version | ConvertTo-Json -Compress))

      while (-not $alice.HasExited -and -not $vite.HasExited) { Start-Sleep -Seconds 5 }
      if ($alice.HasExited) { throw "Alice exited with code $($alice.ExitCode)" }
      throw "Vite exited with code $($vite.ExitCode)"
    } catch {
      ($_ | Out-String) | Add-Content -LiteralPath $runtimeLog
      throw
    } finally {
      Stop-SourceChild $vite
      Stop-SourceChild $alice
    }
  }
  'Switch' {
    & $PSCommandPath -Mode Prepare -Root $Root -DataHome $DataHome -TaskName $TaskName -WebPort $WebPort -McpPort $McpPort -UtaPort $UtaPort -UiPort $UiPort -WaitSeconds $WaitSeconds -NodePath $NodePath -DisableAuth:$DisableAuth -Lite:$Lite -NoInstall:$NoInstall -NoBuild:$NoBuild
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $previousTaskWasRunning = $existingTask -and $existingTask.State.ToString() -eq 'Running'
    if ($existingTask) {
      Write-Stage 'backup-task' { Export-ScheduledTask -TaskName $TaskName | Set-Content -LiteralPath $taskBackupPath }
    }
    try {
      Write-Stage 'stop-old-runtime' {
        if ($existingTask -and $previousTaskWasRunning) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop }
        Stop-SourceProcesses
        Assert-PortsFree @($WebPort, $McpPort, $UtaPort, $UiPort)
      }
      $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      $taskSwitches = ''
      if ($DisableAuth) { $taskSwitches += ' -DisableAuth' }
      if ($Lite) { $taskSwitches += ' -Lite' }
      $runArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Mode Run -Root "{1}" -DataHome "{2}" -TaskName "{3}" -WebPort {4} -McpPort {5} -UtaPort {6} -UiPort {7} -NodePath "{8}"{9}' -f $PSCommandPath, $Root, $DataHome, $TaskName, $WebPort, $McpPort, $UtaPort, $UiPort, (Resolve-NodePath), $taskSwitches
      $scheduledAction = New-ScheduledTaskAction -Execute $powershell -Argument $runArgs -WorkingDirectory $Root
      Write-Stage 'register-task' {
        if ($existingTask) {
          Set-ScheduledTask -TaskName $TaskName -Action $scheduledAction | Out-Null
        } else {
          $user = "$env:USERDOMAIN\$env:USERNAME"
          $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
          $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
          Register-ScheduledTask -TaskName $TaskName -Action $scheduledAction -Trigger $trigger -Principal $principal -Description 'OpenAlice source development runtime' | Out-Null
        }
      }
      Write-Stage 'start-and-probe' {
        Start-SourceTask 15
        Wait-SourceVersion $WebPort $WaitSeconds | Out-Null
        if (-not $Lite) { Wait-UtaHealth $UtaPort $WaitSeconds | Out-Null }
        Wait-Http "http://127.0.0.1:$UiPort/" $WaitSeconds | Out-Null
      }
      $version = Wait-SourceVersion $WebPort 5
      Remove-Item -LiteralPath $taskBackupPath -Force -ErrorAction SilentlyContinue
      [ordered]@{ status = 'ready'; elapsed = (Get-Date).ToString('o'); version = $version; root = $Root; web = "http://127.0.0.1:$WebPort"; ui = "http://127.0.0.1:$UiPort" } | ConvertTo-Json -Depth 5
    } catch {
      try { Write-Stage 'rollback' { Restore-PreviousTask } } catch { Write-Warning ('[source-dev] rollback failed: {0}' -f $_.Exception.Message) }
      throw
    }
  }
}

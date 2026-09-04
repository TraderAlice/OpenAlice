# OpenAlice Windows CLI installer
[CmdletBinding()]
param(
  [ValidateSet('stable', 'beta', 'dev')][string]$Channel = 'stable',
  [string]$Version,
  [string]$Archive,
  [string]$Sha256,
  [string]$InstallDir = $(if ($env:OPENALICE_INSTALL_DIR) { $env:OPENALICE_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.openalice' }),
  [switch]$NoModifyPath,
  [switch]$Plan,
  [switch]$Yes,
  [switch]$Uninstall,
  [int]$WaitForPid
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
if ($env:OS -ne 'Windows_NT') { throw 'This installer requires Windows.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($arch) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw "Unsupported Windows architecture: $arch" } }
$root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\') -or $root -eq $env:USERPROFILE -or $root -match '[\r\n"%!]' ) {
  throw 'Choose a dedicated install directory without command expansion characters.'
}
function Assert-PlainDirectory([string]$path) {
  if (Test-Path -LiteralPath $path) {
    $item = Get-Item -Force -LiteralPath $path
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Installer directory is not a plain directory: $path" }
  }
}
foreach ($path in @($root, (Join-Path $root 'cli'), (Join-Path $root 'cli\releases'), (Join-Path $root 'cli\staging'), (Join-Path $root 'cli\provenance'), (Join-Path $root 'bin'))) { Assert-PlainDirectory $path }
if ($Uninstall) {
  Write-Host "Remove only CLI releases, launchers and owned PATH entry under $root. Preserve all AliceProjects and user data."
  if ($Plan) { return }
  if (-not $Yes -and (Read-Host 'Continue? [y/N]') -notmatch '^(?i)y(es)?$') { return }
  $receipt = Join-Path $root '.cli-uninstall-result.json'
  $guard = $null
  try {
    if ($WaitForPid) {
      $parent = Get-Process -Id $WaitForPid -ErrorAction SilentlyContinue
      if ($parent -and -not $parent.WaitForExit(30000)) { throw 'CLI did not exit; no files removed.' }
    }
    $cliRoot = Join-Path $root 'cli'
    $releasePrefix = (Join-Path $cliRoot 'releases') + '\'
    if (-not [IO.File]::Exists((Join-Path $cliRoot 'current.txt'))) { throw 'Not a managed Windows CLI installation.' }
    $guard = [IO.File]::Open((Join-Path $root '.cli-install.lock.guard'), 'OpenOrCreate', 'ReadWrite', 'None')
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase) })
    if ($running.Count) { throw 'An installed Runtime is still running. Run openalice down for each AliceProject, then retry uninstall.' }
    if (@(Get-ChildItem -Force -Recurse -LiteralPath $cliRoot | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Refusing to remove a CLI tree containing reparse points.' }
    $pathReceipt = Join-Path $cliRoot 'path.json'
    $binDir = Join-Path $root 'bin'
    if ([IO.File]::Exists($pathReceipt)) {
      $owned = Get-Content -Raw -LiteralPath $pathReceipt | ConvertFrom-Json
      if ($owned.added -ne $binDir) { throw 'Invalid owned PATH receipt.' }
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      [Environment]::SetEnvironmentVariable('Path', ((@($userPath -split ';' | Where-Object { $_ -ne $binDir })) -join ';'), 'User')
    }
    foreach ($helper in @('openalice', 'alice', 'alice-workspace', 'alice-uta', 'traderhub')) {
      $launcher = Join-Path $binDir "$helper.cmd"
      if ([IO.File]::Exists($launcher)) { [IO.File]::Delete($launcher) }
    }
    Remove-Item -LiteralPath $cliRoot -Recurse -Force
    foreach ($name in @('.cli-update-check.json', '.cli-uninstall.ps1')) {
      $path = Join-Path $root $name
      if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
    }
    @{ status = 'removed'; dataPreserved = $true } | ConvertTo-Json | Set-Content -LiteralPath $receipt
  } catch {
    @{ status = 'failed'; message = $_.Exception.Message; dataPreserved = $true } | ConvertTo-Json | Set-Content -LiteralPath $receipt
    throw
  } finally { if ($guard) { $guard.Dispose() } }
  return
}
$base = if ($env:OPENALICE_DOWNLOAD_BASE_URL) { $env:OPENALICE_DOWNLOAD_BASE_URL.TrimEnd('/') } else { 'https://download.openalice.ai' }
$installerUrl = if ($env:OPENALICE_INSTALL_URL) { $env:OPENALICE_INSTALL_URL } else { 'https://download.openalice.ai/install.ps1' }
$channelExplicit = $PSBoundParameters.ContainsKey('Channel')
$pinned = [bool]$Version -and -not $channelExplicit
$commit = $null
$identity = $null
function Download-Text([string]$url) {
  if ($url -notmatch '^https://') { throw "Downloads require HTTPS: $url" }
  return (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30).Content
}
if (-not $Archive) {
  if (-not $Version -or $Channel -eq 'dev') {
    $manifestUrl = switch ($Channel) {
      'stable' { if ($env:OPENALICE_STABLE_MANIFEST_URL) { $env:OPENALICE_STABLE_MANIFEST_URL } else { "$base/manifest.json" } }
      'beta' { if ($env:OPENALICE_BETA_MANIFEST_URL) { $env:OPENALICE_BETA_MANIFEST_URL } else { "$base/beta/manifest.json" } }
      'dev' { if ($env:OPENALICE_DEV_MANIFEST_URL) { $env:OPENALICE_DEV_MANIFEST_URL } else { "$base/cli/dev/manifest.json" } }
    }
    $manifest = (Download-Text $manifestUrl) | ConvertFrom-Json
    if ($manifest.channel -ne $Channel) { throw 'Manifest channel mismatch.' }
    $Version = $manifest.version
    if ($Channel -eq 'dev') {
      if ($manifest.repository -ne 'TraderAlice/OpenAlice' -or $manifest.commit -notmatch '^[a-f0-9]{7,64}$') { throw 'Invalid dev identity.' }
      $commit = $manifest.commit
      $targets = @($manifest.additionalTargets | Where-Object { $_.platform -eq 'win32' -and $_.arch -eq $arch })
      if ($targets.Count -ne 1) { throw "This dev candidate has no unique Windows $arch target." }
      $target = $targets[0]
      if ($target.archive -ne "openalice-cli-dev-win32-$arch.tar.gz") { throw 'Unexpected dev archive.' }
      $Sha256 = $target.sha256
      $identity = $target.contentIdentity
      if ($identity -notmatch '^[a-f0-9]{16}$') { throw 'Invalid dev content identity.' }
    }
  }
  if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid release version.' }
  $name = "openalice-cli-$Version-win32-$arch.tar.gz"
  if ($Channel -eq 'dev') { $Archive = "$base/cli/dev/releases/$commit/$name" }
  else {
    $assets = if ($env:OPENALICE_RELEASE_ASSET_BASE_URL) { $env:OPENALICE_RELEASE_ASSET_BASE_URL.TrimEnd('/') } else { 'https://github.com/TraderAlice/OpenAlice/releases/download' }
    $Archive = "$assets/v$Version/$name"
    $sidecar = (Download-Text "$Archive.sha256").Trim()
    if ($sidecar -notmatch ('^([a-f0-9]{64})  ' + [regex]::Escape($name) + '$')) { throw 'Invalid archive checksum sidecar.' }
    $Sha256 = $Matches[1]
  }
}
if ($Sha256 -notmatch '^[a-f0-9]{64}$') { throw 'An archive requires its SHA-256 digest.' }
if ($Version -and -not $pinned -and $Channel -eq 'stable' -and $Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Stable requires a stable version.' }
if ($Version -and -not $pinned -and $Channel -eq 'beta' -and $Version -notmatch '^\d+\.\d+\.\d+-beta(?:\.[1-9][0-9]*)?$') { throw 'Beta requires a beta version.' }
if ($env:OPENALICE_EXPECTED_CLI_ARTIFACT_SHA256 -and $Sha256 -ne $env:OPENALICE_EXPECTED_CLI_ARTIFACT_SHA256) { throw 'Candidate changed since update discovery; check again.' }
if ($env:OPENALICE_EXPECTED_DEV_COMMIT -and $commit -ne $env:OPENALICE_EXPECTED_DEV_COMMIT) { throw 'Dev commit changed since update discovery; check again.' }
Write-Host "OpenAlice CLI installation plan`nChannel         $Channel`nTarget          win32-$arch`nArtifact        $Archive`nSHA-256         $Sha256`nInstall root    $root`nActivation      cli/current.txt (next invocation only)"
Write-Host 'Owns CLI releases and launchers only. Preserves AliceProjects, credentials, user data and external Agent Runtimes. Does not start a service.'
if ($Plan) { return }
if (-not $Yes -and (Read-Host 'Continue? [y/N]') -notmatch '^(?i)y(es)?$') { return }
$cli = Join-Path $root 'cli'
$releases = Join-Path $cli 'releases'
$provenance = Join-Path $cli 'provenance'
$bin = Join-Path $root 'bin'
$current = Join-Path $cli 'current.txt'
$lock = Join-Path $root '.cli-install.lock'
$stage = Join-Path $cli ('staging\' + [guid]::NewGuid().ToString('N'))
$guard = $null
$activated = $false
$previous = $null
$oldReceipt = $null
function Write-Atomic([string]$path, [string]$text) {
  $temporary = "$path.next.$PID.$([guid]::NewGuid().ToString('N'))"
  try {
    [IO.File]::WriteAllText($temporary, $text, (New-Object Text.UTF8Encoding $false))
    if ([IO.File]::Exists($path)) { [IO.File]::Replace($temporary, $path, $null) }
    else { [IO.File]::Move($temporary, $path) }
  } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
try {
  [IO.Directory]::CreateDirectory($root) | Out-Null
  try { $guard = [IO.File]::Open((Join-Path $root '.cli-install.lock.guard'), 'OpenOrCreate', 'ReadWrite', 'None') }
  catch { throw 'Another OpenAlice CLI installer is running.' }
  foreach ($dir in @($releases, $provenance, $bin, $lock, $stage)) { [IO.Directory]::CreateDirectory($dir) | Out-Null }
  [IO.File]::WriteAllText((Join-Path $lock 'pid'), [string]$PID)
  $payload = Join-Path $stage 'payload.tar.gz'
  if ($Archive -match '^https://') { Invoke-WebRequest -UseBasicParsing -Uri $Archive -OutFile $payload -TimeoutSec 180 }
  elseif ($Archive -match '^\w+://') { throw 'Archive URL must use HTTPS.' }
  else { Copy-Item -LiteralPath $Archive -Destination $payload }
  if ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw 'Archive failed SHA-256 verification.' }
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  $entries = @(& $tar -tzf $payload)
  if ($LASTEXITCODE -ne 0 -or $entries.Count -eq 0) { throw 'Cannot read archive.' }
  $top = ($entries[0] -split '/')[0]
  if ($top -notmatch '^openalice-cli-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-win32-(arm64|x64)$') { throw 'Invalid archive root.' }
  $seen = @{}
  foreach ($entry in $entries) {
    $path = $entry.TrimEnd('/')
    if ($path -ne $top -and -not $path.StartsWith("$top/")) { throw 'Archive leaves its release root.' }
    if ($path -match '[\\:\x00-\x1f]' -or $path.Contains(' link to ') -or $seen.ContainsKey($path)) { throw 'Unsafe or duplicate archive path.' }
    $seen[$path] = $true
    foreach ($part in ($path -split '/')) {
      if ($part -in @('', '.', '..') -or $part -match '[. ]$' -or $part -match '^(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsafe Windows path.' }
    }
  }
  $listing = @(& $tar -tvzf $payload)
  if ($LASTEXITCODE -ne 0 -or $listing.Count -ne $entries.Count) { throw 'Cannot verify archive entry types.' }
  $regularFiles = @{}
  for ($index = 0; $index -lt $listing.Count; $index++) {
    $line = $listing[$index]
    $entry = $entries[$index]
    if ($line.StartsWith('-')) { $regularFiles[$entry] = $true }
    elseif ($line.StartsWith('h')) {
      # PortableGit deliberately hard-links duplicate executables/DLLs. Accept
      # only an unambiguous link to an earlier verified regular file in this
      # archive; never a symlink, external path, forward link or directory.
      $marker = " $entry link to "
      if ([regex]::Matches($line, ' link to ').Count -ne 1 -or -not $line.Contains($marker)) { throw 'Ambiguous archive hard link.' }
      $target = $line.Substring($line.IndexOf($marker) + $marker.Length)
      if (-not $regularFiles.ContainsKey($target)) { throw 'Archive hard link leaves previously verified files.' }
      $regularFiles[$entry] = $true
    }
    elseif (-not $line.StartsWith('d')) { throw 'Archive contains a symlink or special file.' }
  }
  & $tar -xzf $payload -C $stage
  if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed.' }
  $expanded = Join-Path $stage $top
  $metadata = Get-Content -Raw -LiteralPath (Join-Path $expanded 'release.json') | ConvertFrom-Json
  if ($metadata.schemaVersion -ne 1 -or $metadata.product -ne 'OpenAlice CLI' -or $metadata.platform -ne 'win32' -or $metadata.arch -ne $arch -or $metadata.contentIdentity -notmatch '^[a-f0-9]{16}$') { throw 'Release metadata does not match this host.' }
  if ($metadata.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or $top -ne "openalice-cli-$($metadata.version)-win32-$arch") { throw 'Release version does not match archive.' }
  if (($Version -and $metadata.version -ne $Version) -or ($env:OPENALICE_EXPECTED_CLI_VERSION -and $metadata.version -ne $env:OPENALICE_EXPECTED_CLI_VERSION)) { throw 'Unexpected product version.' }
  if (($identity -and $metadata.contentIdentity -ne $identity) -or ($env:OPENALICE_EXPECTED_CLI_CONTENT_IDENTITY -and $metadata.contentIdentity -ne $env:OPENALICE_EXPECTED_CLI_CONTENT_IDENTITY)) { throw 'Unexpected content identity.' }
  $Version = $metadata.version
  if (-not $pinned -and $Channel -eq 'stable' -and $Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Stable requires a stable version.' }
  if (-not $pinned -and $Channel -eq 'beta' -and $Version -notmatch '^\d+\.\d+\.\d+-beta(?:\.[1-9][0-9]*)?$') { throw 'Beta requires a beta version.' }
  $exe = Join-Path $expanded 'bin\openalice.exe'
  $reported = & $exe --version
  if ($LASTEXITCODE -ne 0 -or "$reported".Trim() -ne $Version) { throw 'Staged executable verification failed.' }
  $releaseName = "$Version-win32-$arch-$($metadata.contentIdentity)"
  $destination = Join-Path $releases $releaseName
  if (Test-Path -LiteralPath $destination) {
    Assert-PlainDirectory $destination
    if (@(Get-ChildItem -Force -Recurse -LiteralPath $destination | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Existing release contains reparse points.' }
    # Immutable collisions are never overwritten, including when the EXE is mapped.
    foreach ($file in (Get-ChildItem -LiteralPath $expanded -File -Recurse)) {
      $relative = $file.FullName.Substring($expanded.Length + 1)
      $existing = Join-Path $destination $relative
      if (-not (Test-Path -LiteralPath $existing -PathType Leaf) -or (Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $existing).Hash) { throw 'Existing release is damaged; preserve it for inspection.' }
    }
    if (@(Get-ChildItem -LiteralPath $destination -File -Recurse).Count -ne @(Get-ChildItem -LiteralPath $expanded -File -Recurse).Count) { throw 'Existing release contains unexpected files.' }
  } else { [IO.Directory]::Move($expanded, $destination) }
  $source = @{ schemaVersion = 3; repository = 'TraderAlice/OpenAlice'; cliVersion = $Version; method = 'direct';
    installerUrl = $installerUrl; installedAt = [DateTime]::UtcNow.ToString('o');
    updateChannel = $(if ($pinned) { 'pinned' } elseif ($Channel -eq 'dev') { 'development' } else { $Channel });
    selector = $(if ($Channel -eq 'dev') { @{ kind = 'branch'; value = 'dev' } } else { @{ kind = 'version'; value = "v$Version" } });
    artifact = @{ platform = 'win32'; arch = $arch; sha256 = $Sha256 } }
  Write-Atomic (Join-Path $provenance "$releaseName.json") (($source | ConvertTo-Json -Depth 5) + "`n")
  if ([IO.File]::Exists($current)) {
    $previous = [IO.File]::ReadAllText($current).Trim()
    if ($previous -notmatch '^[A-Za-z0-9._+-]+$' -or $previous -in @('.', '..')) { throw 'Invalid previous activation pointer.' }
  }
  $receiptPath = Join-Path $cli 'activation.json'
  if ([IO.File]::Exists($receiptPath)) { $oldReceipt = [IO.File]::ReadAllText($receiptPath) }
  if ($previous -ne $releaseName) {
    $receipt = @{ schemaVersion = 1; activeRelease = $releaseName; previousRelease = $previous; productVersion = $Version; state = 'pending'; activatedAt = [DateTime]::UtcNow.ToString('o') }
    Write-Atomic $receiptPath (($receipt | ConvertTo-Json) + "`n")
    Write-Atomic $current ($releaseName + "`n")
    $activated = $true
  }
  foreach ($helper in @('openalice', 'alice', 'alice-workspace', 'alice-uta', 'traderhub')) {
    $role = if ($helper -eq 'openalice') { '' } else { "--workspace-cli $helper " }
    $launcher = @'
@echo off
setlocal DisableDelayedExpansion
set "OPENALICE_INSTALL_ROOT=%~dp0.."
set /p OPENALICE_RELEASE_NAME=<"%~dp0..\cli\current.txt"
if not defined OPENALICE_RELEASE_NAME exit /b 1
set "OPENALICE_RELEASE_DIR=%~dp0..\cli\releases\%OPENALICE_RELEASE_NAME%"
set "OPENALICE_INSTALL_SOURCE=%~dp0..\cli\provenance\%OPENALICE_RELEASE_NAME%.json"
"%OPENALICE_RELEASE_DIR%\bin\openalice.exe" __ROLE__%*
exit /b %errorlevel%
'@
    Write-Atomic (Join-Path $bin "$helper.cmd") (($launcher.Replace('__ROLE__', $role) -replace "`r?`n", "`r`n") + "`r`n")
  }
  $activeVersion = & (Join-Path $bin 'openalice.cmd') --version
  if ($LASTEXITCODE -ne 0 -or "$activeVersion".Trim() -ne $Version) { throw 'Active launcher verification failed.' }
  if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (@($userPath -split ';') -notcontains $bin) {
      [Environment]::SetEnvironmentVariable('Path', ($bin + ';' + $userPath).TrimEnd(';'), 'User')
      Write-Atomic (Join-Path $cli 'path.json') ((@{ added = $bin } | ConvertTo-Json) + "`n")
    }
    $env:Path = "$bin;$env:Path"
  }
  Write-Host "Installed OpenAlice $Version ($Channel). Open a new terminal and run openalice. Restart an existing Runtime explicitly with down then up."
} catch {
  if ($activated) {
    if ($previous) { Write-Atomic $current ($previous + "`n") } elseif ([IO.File]::Exists($current)) { [IO.File]::Delete($current) }
    if ($oldReceipt) { Write-Atomic (Join-Path $cli 'activation.json') $oldReceipt }
    elseif ([IO.File]::Exists((Join-Path $cli 'activation.json'))) { [IO.File]::Delete((Join-Path $cli 'activation.json')) }
  }
  throw
} finally {
  if ($guard) {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    if (Test-Path -LiteralPath $lock) { Remove-Item -LiteralPath $lock -Recurse -Force }
    $guard.Dispose()
  }
}

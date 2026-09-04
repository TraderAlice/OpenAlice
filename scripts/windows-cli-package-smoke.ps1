param([Parameter(Mandatory=$true)][string]$CandidateDir)
$ErrorActionPreference = 'Stop'
$candidate = Get-Content -Raw -LiteralPath (Join-Path $CandidateDir 'candidate.json') | ConvertFrom-Json
$scratch = Join-Path $env:TEMP ('openalice-npm-acceptance-' + [guid]::NewGuid().ToString('N'))
$packages = Join-Path $scratch 'packages'
$tarballs = Join-Path $scratch 'tarballs'
[IO.Directory]::CreateDirectory($tarballs) | Out-Null
$originalPath = $env:Path
$bun = (Get-Command bun).Source
$npm = (Get-Command npm.cmd).Source
& $bun scripts/build-cli-package-channels.mjs --input-dir $CandidateDir --output-dir $packages --version $candidate.version --released-at ([DateTime]::UtcNow.ToString('o')) --npm-only
if ($LASTEXITCODE -ne 0) { throw 'Package generation failed.' }
$platformName = "openalice-win32-$($candidate.arch)"
$report = & $npm pack (Join-Path $packages "npm\$platformName") --json --pack-destination $tarballs
if ($LASTEXITCODE -ne 0) { throw 'Platform npm pack failed.' }
$platformTarball = Join-Path $tarballs (($report | ConvertFrom-Json)[0].filename)
$metaRoot = Join-Path $packages 'npm\openalice'
$metaPath = Join-Path $metaRoot 'package.json'
$meta = Get-Content -Raw -LiteralPath $metaPath | ConvertFrom-Json
$meta.optionalDependencies.$platformName = 'file:' + ($platformTarball -replace '\\', '/')
[IO.File]::WriteAllText($metaPath, ($meta | ConvertTo-Json -Depth 10))
$report = & $npm pack $metaRoot --json --pack-destination $tarballs
if ($LASTEXITCODE -ne 0) { throw 'Meta npm pack failed.' }
$metaTarball = Join-Path $tarballs (($report | ConvertFrom-Json)[0].filename)
$npmVersion = & $npm --version
$bunVersion = & $bun --version
try {
  foreach ($manager in @('bun', 'npm')) {
    $prefix = Join-Path $scratch "$manager prefix"
    $env:npm_config_cache = Join-Path $scratch "$manager-cache"
    $env:BUN_INSTALL = $prefix
    $env:Path = $originalPath
    if ($manager -eq 'npm') {
      & $npm install --global --prefix $prefix --allow-scripts=openalice --offline --no-audit --no-fund $metaTarball
    } else {
      # Only Bun plus Windows system tools; postinstall must not need host Node.
      $env:Path = (Split-Path $bun) + ';' + (Join-Path $env:SystemRoot 'System32')
      & $bun add --global --trust $metaTarball
    }
    if ($LASTEXITCODE -ne 0) { throw "$manager local install failed." }
    $command = if ($manager -eq 'npm') { Join-Path $prefix 'openalice.cmd' } else { Join-Path $prefix 'bin\openalice.exe' }
    $env:Path = Join-Path $env:SystemRoot 'System32'
    $value = & $command version --json
    if ($LASTEXITCODE -ne 0) { throw "$manager native command still needs an interpreter." }
    $version = $value | ConvertFrom-Json
    if ($version.version -ne $candidate.version -or $version.contentIdentity -ne $candidate.contentIdentity -or $version.installSource.method -ne $manager) { throw "$manager installed identity mismatch." }
    $update = & $command update --yes
    if ($LASTEXITCODE -ne 0 -or "$update" -notmatch "$manager.*openalice") { throw 'Update ownership was not preserved.' }
    $uninstall = & $command uninstall --yes
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $command)) { throw 'CLI modified manager-owned files.' }
    $env:Path = $originalPath
    if ($manager -eq 'npm') { & $npm uninstall --global --prefix $prefix openalice }
    else { & $bun remove --global openalice }
    if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $command)) { throw "$manager removal failed." }
  }
  @{ status = 'pass'; arch = $candidate.arch; contentIdentity = $candidate.contentIdentity; npm = "$npmVersion"; bun = "$bunVersion";
    accepted = @('local npm tarball install', 'Bun install without host Node', 'native Windows command shims', 'package-manager update ownership', 'manager removal') } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $CandidateDir 'package-manager-smoke.json')
} finally { $env:Path = $originalPath }

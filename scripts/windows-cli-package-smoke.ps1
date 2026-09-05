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
function Get-PackFilename([string]$Json) {
  $parsed = ConvertFrom-Json -InputObject $Json
  # ConvertFrom-Json can unwrap a one-element legacy JSON array into an object.
  $entries = if ($parsed -is [array] -or $parsed.PSObject.Properties.Name -contains 'filename') { @($parsed) } else { @($parsed.PSObject.Properties | ForEach-Object { $_.Value }) }
  if ($entries.Count -ne 1 -or -not $entries[0].filename) { throw 'Invalid npm pack JSON report.' }
  return $entries[0].filename
}
& $bun scripts/build-cli-package-channels.mjs --input-dir $CandidateDir --output-dir $packages --version $candidate.version --released-at ([DateTime]::UtcNow.ToString('o')) --npm-only
if ($LASTEXITCODE -ne 0) { throw 'Package generation failed.' }
$platformName = "openalice-windows-$($candidate.arch)"
$report = & $npm pack (Join-Path $packages "npm\$platformName") --json --pack-destination $tarballs
if ($LASTEXITCODE -ne 0) { throw 'Platform npm pack failed.' }
$platformTarball = Join-Path $tarballs (Get-PackFilename ($report -join "`n"))
$metaRoot = Join-Path $packages 'npm\openalice'
$metaPath = Join-Path $metaRoot 'package.json'
$meta = Get-Content -Raw -LiteralPath $metaPath | ConvertFrom-Json
$meta.optionalDependencies.$platformName = 'file:' + ($platformTarball -replace '\\', '/')
[IO.File]::WriteAllText($metaPath, ($meta | ConvertTo-Json -Depth 10))
$report = & $npm pack $metaRoot --json --pack-destination $tarballs
if ($LASTEXITCODE -ne 0) { throw 'Meta npm pack failed.' }
$metaTarball = Join-Path $tarballs (Get-PackFilename ($report -join "`n"))
$npmVersion = & $npm --version
$bunVersion = & $bun --version
$limitations = @()
try {
  foreach ($manager in @('bun', 'npm')) {
    $prefix = Join-Path $scratch "$manager prefix"
    $env:npm_config_cache = Join-Path $scratch "$manager-cache"
    $env:BUN_INSTALL = $prefix
    $env:Path = $originalPath
    if ($manager -eq 'npm') {
      & $npm install --global --prefix $prefix ("--allow-scripts=file:" + ($metaTarball -replace '\\', '/')) --offline --no-audit --no-fund $metaTarball
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
    $setup = & $command setup --check --json
    if ($LASTEXITCODE -ne 0) { throw "$manager needs system Git/Bash; finish openalice setup before acceptance." }
    if (($setup | ConvertFrom-Json).status -ne 'ready') { throw "$manager dependency inspection failed." }
    $update = & $command update --yes
    if ($LASTEXITCODE -ne 0 -or "$update" -notmatch "$manager.*openalice") { throw 'Update ownership was not preserved.' }
    $uninstall = & $command uninstall --yes
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $command)) { throw 'CLI modified manager-owned files.' }
    $env:Path = $originalPath
    if ($manager -eq 'npm') { & $npm uninstall --global --prefix $prefix openalice }
    else { & $bun remove --global openalice }
    if ($LASTEXITCODE -ne 0) { throw "$manager removal failed." }
    $installedPackage = if ($manager -eq 'npm') { Join-Path $prefix 'node_modules\openalice' } else { Join-Path $prefix 'install\global\node_modules\openalice' }
    if (Test-Path -LiteralPath $installedPackage) { throw "$manager left the installed package behind." }
    if (Test-Path -LiteralPath $command) {
      if ($manager -ne 'bun') { throw "$manager left its command behind." }
      # Do not repair another manager's files or describe this as a clean
      # uninstall. Bun's known Windows residue is tracked in OpenAlice #1347.
      $limitations += "Bun left its global entrypoint after package removal: $command (OpenAlice #1347 / oven-sh/bun#11970)"
      Write-Warning $limitations[-1]
    }
  }
  @{ status = 'pass'; arch = $candidate.arch; contentIdentity = $candidate.contentIdentity; npm = "$npmVersion"; bun = "$bunVersion";
    limitations = $limitations;
    accepted = @('local npm tarball install', 'Bun install without host Node', 'native Windows command shims', 'package-manager update ownership', 'manager-owned package removal; entrypoint caveat recorded') } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $CandidateDir 'package-manager-smoke.json')
} finally { $env:Path = $originalPath }

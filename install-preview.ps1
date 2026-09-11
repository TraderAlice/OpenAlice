# Windows CLI preview: checksum-verified, side-by-side, standard-user install.
# No administrator rights, execution-policy changes, PATH/profile mutations,
# service registration, Agent Runtime installation, or user-data removal.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Sha256,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [switch]$Yes,
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This preview installer requires Windows.' }
$destination = [IO.Path]::GetFullPath($InstallDir)
if (Test-Path -LiteralPath $destination) {
    throw "Destination already exists. Choose a new side-by-side directory: $destination"
}
Write-Host "OpenAlice Windows preview -> $destination"
Write-Host "Archive: $Archive"
Write-Host "SHA-256: $Sha256"
Write-Host 'Installs OpenAlice and private Git/Bash only. Does not start services or install agents.'
Write-Host 'Updates are manual: install into a new directory, stop the old Runtime, then start the new one.'
if ($Plan) { return }
if (-not $Yes -and (Read-Host 'Install this preview? [y/N]') -notmatch '^[yY]$') {
    throw 'Installation declined.'
}
$parent = [IO.Path]::GetDirectoryName($destination)
[IO.Directory]::CreateDirectory($parent) | Out-Null
$stage = Join-Path $parent ('.openalice-preview-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage) | Out-Null
try {
    $zipPath = Join-Path $stage 'candidate.zip'
    if ($Archive -match '^https://') {
        Invoke-WebRequest -UseBasicParsing -Uri $Archive -OutFile $zipPath
    } elseif ($Archive -match '^[a-zA-Z]+://') {
        throw 'Only HTTPS downloads or local archives are allowed.'
    } else {
        Copy-Item -LiteralPath $Archive -Destination $zipPath
    }
    if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ine $Sha256) {
        throw 'Archive SHA-256 mismatch.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
    $unpacked = Join-Path $stage 'payload'
    $roots = @{}
    $paths = @{}
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            $parts = $name.TrimEnd('/').Split('/')
            if ($name.StartsWith('/') -or $name.Contains(':') -or $parts.Count -lt 1) { throw 'Unsafe archive path.' }
            foreach ($part in $parts) {
                if ($part -eq '' -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or
                    $part -match '[\x00-\x1f]' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
                    throw "Unsafe archive path: $name"
                }
            }
            # Reject Unix symlinks even when unpacking on Windows.
            if ((($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000) { throw 'Archive symlinks are not allowed.' }
            if ($paths.ContainsKey($name.ToLowerInvariant())) { throw 'Duplicate archive path.' }
            $paths[$name.ToLowerInvariant()] = $true
            $roots[$parts[0]] = $true
        }
    } finally { $zip.Dispose() }
    if ($roots.Count -ne 1) { throw 'Expected exactly one release directory.' }
    [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $unpacked)
    $release = Join-Path $unpacked @($roots.Keys)[0]
    $metadata = Get-Content -LiteralPath (Join-Path $release 'release.json') -Raw | ConvertFrom-Json
    $hostArch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    if ($metadata.platform -ne 'win32' -or $metadata.arch -ne $hostArch -or $metadata.preview -ne $true -or
        $metadata.executable -ne 'bin/openalice.exe' -or $metadata.resourceRoot -ne 'share/openalice') {
        throw "Archive does not match this Windows $hostArch host."
    }
    $exe = Join-Path $release 'bin/openalice.exe'
    $version = & $exe --version
    if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne $metadata.version) { throw 'Staged executable version check failed.' }
    # Directory.Move refuses an existing destination, including a competing install.
    [IO.Directory]::Move($release, $destination)
} finally {
    # Only this invocation's random staging directory is removed; no user data.
    Remove-Item -LiteralPath $stage -Recurse -Force
}
Write-Host "Installed preview. Run: & '$destination\bin\openalice.exe'"
Write-Host 'To remove it, stop its Runtime and delete this installation directory only. Keep your OpenAlice data.'

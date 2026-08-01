param(
  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
$Distro = 'SquidSketch'
$AppRoot = Join-Path $env:LOCALAPPDATA 'SquidSketch'
$WslRoot = Join-Path $AppRoot 'wsl'
$DownloadRoot = Join-Path $AppRoot 'downloads'
$Archive = Join-Path $DownloadRoot 'ubuntu-wsl-rootfs.tar.gz'

New-Item -ItemType Directory -Force -Path (Split-Path $StatePath), $AppRoot, $DownloadRoot | Out-Null

$state = @{
  schema = 1
  installedAt = (Get-Date).ToString('o')
  distro = $Distro
  createdDistroByApp = $false
  installedUsbipdByApp = $false
  enabledWslFeatureByApp = $false
  enabledVmFeatureByApp = $false
  boundBluetoothByApp = @()
  restartRequired = $false
}
if (Test-Path $StatePath) {
  $previous = Get-Content -Raw $StatePath | ConvertFrom-Json
  foreach ($property in $previous.PSObject.Properties) { $state[$property.Name] = $property.Value }
}
# A previous run may have requested a reboot. Re-evaluate the live feature state
# on every run instead of carrying that request forward forever.
$state.restartRequired = $false

function Save-State {
  $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $StatePath
}

Write-Host '[1/5] Checking WSL system components'
$wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
if ($wslFeature.State -ne 'Enabled') {
  Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null
  $state.enabledWslFeatureByApp = $true
  $state.restartRequired = $true
}
$vmFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
if ($vmFeature.State -ne 'Enabled') {
  Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null
  $state.enabledVmFeatureByApp = $true
  $state.restartRequired = $true
}
Save-State

Write-Host '[2/5] Checking usbipd-win'
if (-not (Get-Command usbipd.exe -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'winget was not found. Update App Installer from Microsoft Store and try again.'
  }
  winget.exe install --id dorssel.usbipd-win --exact --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "usbipd-win installation failed with exit code $LASTEXITCODE" }
  $state.installedUsbipdByApp = $true
  Save-State
}

if ($state.restartRequired) {
  Write-Host 'Windows features were enabled. Restart Windows, then run dependency setup again.'
  Save-State
  exit 0
}

Write-Host '[3/5] Updating the WSL kernel'
wsl.exe --update --web-download
if ($LASTEXITCODE -ne 0) {
  Write-Warning "WSL online update was unavailable (exit code $LASTEXITCODE). Continuing with the installed WSL 2 kernel."
}

$distros = @(wsl.exe --list --quiet | ForEach-Object { ($_ -replace "`0", '').Trim() })
if ($distros -notcontains $Distro) {
  Write-Host '[4/5] Downloading and importing the dedicated Linux environment'
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
  $rootfsUrl = "https://cloud-images.ubuntu.com/wsl/releases/noble/current/ubuntu-noble-wsl-$arch-wsl.rootfs.tar.gz"
  if (-not (Test-Path $Archive)) {
    Invoke-WebRequest -UseBasicParsing -Uri $rootfsUrl -OutFile $Archive
  }
  New-Item -ItemType Directory -Force -Path $WslRoot | Out-Null
  wsl.exe --import $Distro $WslRoot $Archive --version 2
  if ($LASTEXITCODE -ne 0) { throw "WSL distribution import failed with exit code $LASTEXITCODE" }
  $state.createdDistroByApp = $true
  Save-State
}

Write-Host '[5/5] Installing BlueZ, Python and NXBT'
$linuxSetupWindowsPath = Join-Path $PSScriptRoot 'linux-setup.sh'
$linuxSetupPath = (wsl.exe -d $Distro -u root -- wslpath -a $linuxSetupWindowsPath | ForEach-Object { ($_ -replace "`0", '').Trim() })
wsl.exe -d $Distro -u root -- bash $linuxSetupPath
if ($LASTEXITCODE -ne 0) { throw "Linux dependency setup failed with exit code $LASTEXITCODE" }
wsl.exe --terminate $Distro

$state.restartRequired = $false
$state.completed = $true
$state.completedAt = (Get-Date).ToString('o')
Save-State
Write-Host 'SplatoonDeck dependency setup completed.'

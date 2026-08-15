param(
  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'Continue'
$Distro = 'SquidSketch'
$AppRoot = Join-Path $env:LOCALAPPDATA 'SquidSketch'
$WslRoot = Join-Path $AppRoot 'wsl'
$DownloadRoot = Join-Path $AppRoot 'downloads'
$Archive = Join-Path $DownloadRoot 'ubuntu-wsl-rootfs.tar.gz'

New-Item -ItemType Directory -Force -Path (Split-Path $StatePath), $AppRoot, $DownloadRoot | Out-Null

function Write-Step([string]$Number, [string]$Message) {
  Write-Host "[$Number] $Message" -ForegroundColor Cyan
}

function Write-Detail([string]$Message) {
  Write-Host "  -> $Message" -ForegroundColor DarkGray
}

function Get-WslAppPackages {
  @(Get-AppxPackage -Name MicrosoftCorporationII.WindowsSubsystemForLinux -ErrorAction SilentlyContinue | ForEach-Object { $_.PackageFullName })
}

function Get-WslMsiProducts {
  $roots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  @($roots | ForEach-Object {
    Get-ItemProperty $_ -ErrorAction SilentlyContinue | Where-Object {
      $_.DisplayName -match '^Windows Subsystem for Linux(?: Update)?$'
    } | ForEach-Object { $_.PSChildName }
  } | Where-Object { $_ } | Select-Object -Unique)
}

$hasPreviousState = Test-Path $StatePath
$wslAppsBefore = @(Get-WslAppPackages)
$wslMsiBefore = @(Get-WslMsiProducts)
$wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
$wslEnvironmentExistedBefore = [bool](
  $wslFeature.State -eq 'Enabled' -or
  $wslAppsBefore.Count -gt 0 -or
  $wslMsiBefore.Count -gt 0
)

$state = @{
  schema = 2
  installedAt = (Get-Date).ToString('o')
  distro = $Distro
  createdDistroByApp = $false
  installedUsbipdByApp = $false
  enabledWslFeatureByApp = $false
  enabledVmFeatureByApp = $false
  boundBluetoothByApp = @()
  restartRequired = $false
  restartReason = $null
  lifecycle = 'installing'
  wslAppPackagesBefore = $wslAppsBefore
  wslMsiProductsBefore = $wslMsiBefore
  wslEnvironmentExistedBefore = $wslEnvironmentExistedBefore
  installedWslAppPackagesByApp = @()
  installedWslMsiProductsByApp = @()
}
if ($hasPreviousState) {
  $previous = Get-Content -Raw $StatePath | ConvertFrom-Json
  # A completed cleanup starts a new ownership record. Interrupted installs and
  # restarts keep their original snapshot so existing user components stay safe.
  if ($previous.lifecycle -ne 'uninstalled') {
    foreach ($property in $previous.PSObject.Properties) { $state[$property.Name] = $property.Value }
  }
}
# A previous run may have requested a reboot. Re-evaluate the live feature state
# on every run instead of carrying that request forward forever.
$state.restartRequired = $false
$state.restartReason = $null
$state.lifecycle = 'installing'

function Save-State {
  $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $StatePath
}

Write-Step '1/5' 'Checking WSL system components'
if ($wslFeature.State -ne 'Enabled') {
  Write-Detail 'Enabling Windows Subsystem for Linux.'
  Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null
  $state.enabledWslFeatureByApp = $true
  $state.restartRequired = $true
} else {
  Write-Detail 'Windows Subsystem for Linux is already enabled; it will be preserved during cleanup.'
}
$vmFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
if ($vmFeature.State -ne 'Enabled') {
  Write-Detail 'Enabling Virtual Machine Platform.'
  Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null
  $state.enabledVmFeatureByApp = $true
  $state.restartRequired = $true
} else {
  Write-Detail 'Virtual Machine Platform is already enabled; it will be preserved during cleanup.'
}
Save-State

Write-Step '2/5' 'Checking usbipd-win'
if (-not (Get-Command usbipd.exe -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'winget was not found. Update App Installer from Microsoft Store and try again.'
  }
  Write-Detail 'Downloading and installing usbipd-win with winget.'
  winget.exe install --id dorssel.usbipd-win --exact --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "usbipd-win installation failed with exit code $LASTEXITCODE" }
  $state.installedUsbipdByApp = $true
  Save-State
} else {
  Write-Detail 'usbipd-win is already installed; it will be preserved during cleanup.'
}

if ($state.restartRequired) {
  $state.restartReason = 'install'
  $state.lifecycle = 'installing'
  Write-Host 'Windows features were enabled. Restart Windows, then run dependency setup again.'
  Save-State
  return
}

Write-Step '3/5' 'Updating the WSL runtime'
Write-Detail 'Checking Microsoft WSL updates. This may take several minutes.'
wsl.exe --update --web-download
if ($LASTEXITCODE -ne 0) {
  Write-Warning "WSL online update was unavailable (exit code $LASTEXITCODE). Continuing with the installed WSL 2 kernel."
} else {
  Write-Detail 'WSL runtime is ready.'
}
$wslAppsAfter = @(Get-WslAppPackages)
$wslMsiAfter = @(Get-WslMsiProducts)
if (-not $state.wslEnvironmentExistedBefore) {
  $state.installedWslAppPackagesByApp = @($wslAppsAfter | Where-Object { $state.wslAppPackagesBefore -notcontains $_ })
  $state.installedWslMsiProductsByApp = @($wslMsiAfter | Where-Object { $state.wslMsiProductsBefore -notcontains $_ })
} else {
  # Updating an existing WSL installation can change package version IDs. The
  # environment still belongs to the user, so none of those packages are ours.
  $state.installedWslAppPackagesByApp = @()
  $state.installedWslMsiProductsByApp = @()
}
Save-State

$distros = @(wsl.exe --list --quiet | ForEach-Object { ($_ -replace "`0", '').Trim() })
if ($distros -notcontains $Distro) {
  Write-Step '4/5' 'Downloading and importing the dedicated Linux environment'
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
  $rootfsUrl = "https://cloud-images.ubuntu.com/wsl/releases/noble/current/ubuntu-noble-wsl-$arch-wsl.rootfs.tar.gz"
  if (-not (Test-Path $Archive)) {
    Write-Detail "Downloading Ubuntu root filesystem for $arch."
    Invoke-WebRequest -UseBasicParsing -Uri $rootfsUrl -OutFile $Archive
  } else {
    Write-Detail 'Using the previously downloaded Ubuntu root filesystem.'
  }
  Write-Detail 'Importing the isolated SplatoonDeck Linux environment.'
  New-Item -ItemType Directory -Force -Path $WslRoot | Out-Null
  wsl.exe --import $Distro $WslRoot $Archive --version 2 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WSL distribution import failed with exit code $LASTEXITCODE" }
  $state.createdDistroByApp = $true
  Save-State
} else {
  Write-Step '4/5' 'Checking the dedicated Linux environment'
  Write-Detail 'The SplatoonDeck Linux environment is already present.'
}

Write-Step '5/5' 'Installing BlueZ, Python and NXBT'
Write-Detail 'Linux package output will appear below.'
$linuxSetupWindowsPath = Join-Path $PSScriptRoot 'linux-setup.sh'
$escapedLinuxSetupWindowsPath = $linuxSetupWindowsPath.Replace('\', '\\')
$linuxSetupPath = (wsl.exe -d $Distro -u root -- wslpath -a $escapedLinuxSetupWindowsPath | ForEach-Object { ($_ -replace "`0", '').Trim() })
if ($LASTEXITCODE -ne 0 -or -not $linuxSetupPath) {
  throw 'Could not resolve the Linux dependency setup path.'
}
& wsl.exe -d $Distro -u root -- bash $linuxSetupPath
if ($LASTEXITCODE -ne 0) { throw "Linux dependency setup failed with exit code $LASTEXITCODE." }
Write-Detail 'Stopping the setup environment cleanly.'
wsl.exe --terminate $Distro | Out-Null

$state.restartRequired = $false
$state.restartReason = $null
$state.lifecycle = 'installed'
$state.completed = $true
$state.completedAt = (Get-Date).ToString('o')
Save-State
Write-Host 'SplatoonDeck dependency setup completed.'

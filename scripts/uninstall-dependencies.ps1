param(
  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $StatePath)) {
  Write-Host 'No SquidDeck install record was found. Nothing was removed.'
  exit 0
}

$state = Get-Content -Raw $StatePath | ConvertFrom-Json
$Distro = 'SquidSketch'
$AppRoot = Join-Path $env:LOCALAPPDATA 'SquidSketch'

Write-Host '[1/4] Returning and unsharing Bluetooth devices owned by SquidDeck'
if (Get-Command usbipd.exe -ErrorAction SilentlyContinue) {
  try {
    $usbState = usbipd.exe state | ConvertFrom-Json
    $ownedDevices = @($state.boundBluetoothByApp)
    foreach ($record in $ownedDevices) {
      $device = $null
      if ($record.instanceId) {
        $device = @($usbState.Devices | Where-Object { $_.InstanceId -eq $record.instanceId }) | Select-Object -First 1
      }
      if (-not $device -and $record.busId) {
        $device = @($usbState.Devices | Where-Object { $_.BusId -eq $record.busId }) | Select-Object -First 1
      }
      if ($device -and $device.BusId -and $device.ClientIPAddress) {
        usbipd.exe detach --busid $device.BusId
      }
      if ($device -and $device.BusId -and $device.PersistedGuid) {
        usbipd.exe unbind --busid $device.BusId
        if ($LASTEXITCODE -ne 0) { throw "Failed to unshare Bluetooth device $($device.BusId)" }
      }
    }
    $state.boundBluetoothByApp = @()
  } catch {
    throw "Bluetooth sharing cleanup failed: $($_.Exception.Message)"
  }
}

Write-Host '[2/4] Removing the dedicated Linux environment'
$distros = @(wsl.exe --list --quiet | ForEach-Object { ($_ -replace "`0", '').Trim() })
if ($state.createdDistroByApp -and $distros -contains $Distro) {
  wsl.exe --terminate $Distro
  wsl.exe --unregister $Distro
}
if (Test-Path -LiteralPath $AppRoot) {
  $expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'SquidSketch'))
  $actualRoot = [System.IO.Path]::GetFullPath($AppRoot)
  if ($actualRoot -ne $expectedRoot) { throw 'Refusing to remove an unexpected application data path.' }
  Remove-Item -LiteralPath $actualRoot -Recurse -Force
}

Write-Host '[3/4] Removing usbipd-win when installed by this app'
if ($state.installedUsbipdByApp -and (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
  winget.exe uninstall --id dorssel.usbipd-win --exact --disable-interactivity
}

Write-Host '[4/4] Checking shared Windows features'
$remainingDistros = @(wsl.exe --list --quiet | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ })
if ($remainingDistros.Count -eq 0 -and $state.enabledWslFeatureByApp) {
  Disable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart | Out-Null
  Write-Host 'Disabled the WSL feature enabled by this app because no other distributions use it.'
} elseif ($state.enabledWslFeatureByApp) {
  Write-Host 'Other WSL distributions were found, so the shared WSL feature was retained.'
}

# VirtualMachinePlatform can be shared by Docker, emulators and other tools. It is intentionally retained.
$state.completed = $false
$state.uninstalledAt = (Get-Date).ToString('o')
$state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $StatePath
Write-Host 'Cleanup completed. VirtualMachinePlatform was retained because it can be shared by other software.'

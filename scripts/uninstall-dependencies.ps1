param(
  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$SessionPath = Join-Path (Split-Path -Parent $StatePath) 'bluetooth-session.json'
if (-not (Test-Path $StatePath)) {
  Remove-Item -LiteralPath $SessionPath -Force -ErrorAction SilentlyContinue
  Write-Host 'No SplatoonDeck install record was found. Nothing was removed.'
  exit 0
}

$storedState = Get-Content -Raw $StatePath | ConvertFrom-Json
$state = @{}
foreach ($property in $storedState.PSObject.Properties) { $state[$property.Name] = $property.Value }
$Distro = 'SquidSketch'
$AppRoot = Join-Path $env:LOCALAPPDATA 'SquidSketch'

Write-Host '[1/4] Returning and unsharing Bluetooth devices owned by SplatoonDeck'
if (Get-Command usbipd.exe -ErrorAction SilentlyContinue) {
  try {
    $ownedDevices = @($state.boundBluetoothByApp)
    foreach ($record in $ownedDevices) {
      $usbState = usbipd.exe state | ConvertFrom-Json
      $device = $null
      if ($record.instanceId) {
        $device = @($usbState.Devices | Where-Object { $_.InstanceId -eq $record.instanceId }) | Select-Object -First 1
      }
      if (-not $device -and $record.busId) {
        $device = @($usbState.Devices | Where-Object { $_.BusId -eq $record.busId }) | Select-Object -First 1
      }
      $wasBound = [bool]($device -and $device.PersistedGuid)
      if ($device -and $device.BusId -and $device.ClientIPAddress) {
        usbipd.exe detach --busid $device.BusId | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Failed to return Bluetooth device $($device.BusId)" }
        $device = $null
        for ($attempt = 0; $attempt -lt 20 -and -not $device; $attempt++) {
          Start-Sleep -Milliseconds 250
          $refreshedState = usbipd.exe state | ConvertFrom-Json
          if ($record.instanceId) {
            $device = @($refreshedState.Devices | Where-Object { $_.InstanceId -eq $record.instanceId -and -not $_.ClientIPAddress }) | Select-Object -First 1
          }
          if (-not $device -and $record.busId) {
            $device = @($refreshedState.Devices | Where-Object { $_.BusId -eq $record.busId -and -not $_.ClientIPAddress }) | Select-Object -First 1
          }
        }
      }
      if ($device -and $device.BusId -and $device.PersistedGuid) {
        usbipd.exe unbind --busid $device.BusId | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Failed to unshare Bluetooth device $($device.BusId)" }
      } elseif ($wasBound -and -not $device) {
        throw "Bluetooth device did not return to Windows in time: $($record.instanceId)"
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
  wsl.exe --terminate $Distro | Out-Null
  wsl.exe --unregister $Distro | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to unregister WSL distribution $Distro" }
}
$state.createdDistroByApp = $false
if (Test-Path -LiteralPath $AppRoot) {
  $expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'SquidSketch'))
  $actualRoot = [System.IO.Path]::GetFullPath($AppRoot)
  if ($actualRoot -ne $expectedRoot) { throw 'Refusing to remove an unexpected application data path.' }
  Remove-Item -LiteralPath $actualRoot -Recurse -Force
}

Write-Host '[3/4] Removing usbipd-win when installed by this app'
if ($state.installedUsbipdByApp) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'winget was not found, so usbipd-win could not be removed.'
  }
  winget.exe uninstall --id dorssel.usbipd-win --exact --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "usbipd-win uninstall failed with exit code $LASTEXITCODE" }
}
$state.installedUsbipdByApp = $false

Write-Host '[4/4] Checking shared Windows features'
$restartNeeded = $false
$remainingDistros = @(wsl.exe --list --quiet | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ })
if ($remainingDistros.Count -eq 0 -and $state.enabledWslFeatureByApp) {
  $wslDisable = Disable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart
  $restartNeeded = [bool]($restartNeeded -or $wslDisable.RestartNeeded)
  Write-Host 'Disabled the WSL feature enabled by this app because no other distributions use it.'
} elseif ($state.enabledWslFeatureByApp) {
  Write-Host 'Other WSL distributions were found, so the shared WSL feature was retained.'
}
$state.enabledWslFeatureByApp = $false

if ($remainingDistros.Count -eq 0 -and $state.enabledVmFeatureByApp) {
  $vmDisable = Disable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart
  $restartNeeded = [bool]($restartNeeded -or $vmDisable.RestartNeeded)
  Write-Host 'Disabled VirtualMachinePlatform because this app enabled it and no WSL distributions remain.'
} elseif ($state.enabledVmFeatureByApp) {
  Write-Host 'Other WSL distributions were found, so VirtualMachinePlatform was retained.'
}
$state.enabledVmFeatureByApp = $false
$state.completed = $false
$state.restartRequired = $restartNeeded
$state.uninstalledAt = (Get-Date).ToString('o')
$state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $StatePath
Remove-Item -LiteralPath $SessionPath -Force -ErrorAction SilentlyContinue
Write-Host 'SplatoonDeck dependency cleanup completed.'

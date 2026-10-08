$ErrorActionPreference='Stop'
$os=Get-CimInstance Win32_OperatingSystem
$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
$physical=[math]::Round($os.FreePhysicalMemory/1MB,2)
$virtual=[math]::Round($os.FreeVirtualMemory/1MB,2)
$files=@(Get-CimInstance Win32_PageFileUsage | ForEach-Object { [pscustomobject]@{name=$_.Name;allocatedMb=$_.AllocatedBaseSize;usedMb=$_.CurrentUsage} })
$adb='D:\Program Files\platform-tools\adb.exe'
$online=@(& $adb devices | Select-String '^emulator-[0-9]+\s+device')
$report=[ordered]@{host=[System.Environment]::MachineName;freePhysicalGb=$physical;freeVirtualGb=$virtual;pagefiles=$files;runningEmulators=$online.Count;cpuVirtualizationFirmwareEnabled=$cpu.VirtualizationFirmwareEnabled;android14RecommendedFreeVirtualGb=10;android14HostPreflight=if($physical -ge 8 -and $virtual -ge 10){'ready_for_attempt'}else{'insufficient_resources'}}
$report | ConvertTo-Json -Depth 5
if($report.android14HostPreflight -ne 'ready_for_attempt'){exit 2}

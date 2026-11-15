[CmdletBinding()]
param(
    [ValidatePattern('^[^\\/\[\]*?\r\n]+$')]
    [string] $TaskName = 'AIPM Workspace',
    [ValidateRange(1, 65535)]
    [int] $Port = 4317,
    [string] $DataDir,
    [switch] $UseProxy,
    [string] $NodePath = (Get-Command node.exe -CommandType Application).Source,
    [string] $ConfigFile,
    [switch] $Yes
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/task-settings.ps1"

if (Get-AipmAutostartTask $TaskName) { throw 'The task is already installed. Uninstall it before changing its settings.' }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'dist/index.html') -PathType Leaf)) {
    throw 'Run npm run build in the project before installing autostart.'
}
$node = Get-Item -LiteralPath $NodePath
if ($node.PSIsContainer -or $node.Name -ne 'node.exe') { throw 'NodePath must point to node.exe.' }
if (-not $DataDir) { $DataDir = Join-Path $repoRoot 'workspace' }
$dataDirPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DataDir)
$configFilePath = if ($ConfigFile) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ConfigFile) } else { $null }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$settings = @{
    Id = [guid]::NewGuid().ToString('N')
    Port = $Port
    DataDir = $dataDirPath
    UseProxy = [bool] $UseProxy
    NodePath = $node.FullName
    ConfigFile = $configFilePath
}
# Task action carries only non-secret settings. Encoding preserves spaces and Unicode paths.
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($settings | ConvertTo-Json -Compress)))
$arguments = $commandPrefix + $payload + $commandSuffix

$configDescription = if ($configFilePath) { $configFilePath } else { 'server default' }
Write-Host "Task:        \$TaskName"
Write-Host "Account:     $user (interactive login, limited privileges)"
Write-Host "Trigger:     at login"
Write-Host "Restart:     launcher retries failures after 1 minute, up to 3 times"
Write-Host "Action:      $windowsPowerShell (hidden) $launcher"
Write-Host "Directory:   $repoRoot"
Write-Host "Node:        $($node.FullName) --import tsx server/index.ts --production"
Write-Host "Address:     http://127.0.0.1:$Port/"
Write-Host "Data:        $dataDirPath"
Write-Host "Proxy:       $([bool] $UseProxy)"
Write-Host "Config file: $configDescription"
Write-Host "Logs:        $(Join-Path $dataDirPath 'state/runtime-logs') (14 days)"
if (-not $Yes -and (Read-Host 'Register this task? [y/N]') -notin @('y', 'yes')) {
    Write-Host 'Installation cancelled.'
    return
}

$action = New-ScheduledTaskAction -Execute $windowsPowerShell -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Action $action -Trigger $trigger -Principal $principal `
    -Settings $taskSettings -Description 'Starts the local AIPM Workspace production process at login.' | Out-Null
Write-Host "Installed. Start now with: Start-ScheduledTask -TaskName '$($TaskName.Replace("'", "''"))'"

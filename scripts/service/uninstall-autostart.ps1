[CmdletBinding()]
param([ValidatePattern('^[^\\/\[\]*?\r\n]+$')] [string] $TaskName = 'AIPM Workspace')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/task-settings.ps1"

$installed = Get-AipmAutostartTask $TaskName
if (-not $installed) { Write-Host 'The task is not installed.'; return }

$installed.Task | Disable-ScheduledTask | Out-Null
$installed.Task | Stop-ScheduledTask
Stop-AipmAutostartChildren $installed.Settings
$installed.Task | Unregister-ScheduledTask -Confirm:$false
Write-Host "Removed task: $TaskName"

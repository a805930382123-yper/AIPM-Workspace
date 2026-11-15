[CmdletBinding()]
param([ValidatePattern('^[^\\/\[\]*?\r\n]+$')] [string] $TaskName = 'AIPM Workspace')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/task-settings.ps1"

$installed = Get-AipmAutostartTask $TaskName
if (-not $installed) {
    [pscustomobject] @{ TaskName = $TaskName; TaskState = 'NotInstalled'; PID = $null; Port = $null; Health = 'NotRunning' }
    return
}
$settings = $installed.Settings
$node = Get-AipmAutostartProcess $settings
$lockPath = Join-Path $settings.DataDir 'state/runtime/instance.lock'
$health = 'NotRunning'
if ($node) {
    $health = 'NotReady'
    try {
        $owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
        if ($owner.pid -in $node.ProcessId -and $owner.port -eq $settings.Port -and $owner.mode -eq 'production') {
            $request = [Net.WebRequest]::Create("http://127.0.0.1:$($settings.Port)/api/health")
            $request.Timeout = 2500
            $request.Proxy = $null
            $request.AllowAutoRedirect = $false
            $response = $request.GetResponse()
            try {
                $reader = [IO.StreamReader]::new($response.GetResponseStream())
                try {
                    $body = $reader.ReadToEnd() | ConvertFrom-Json
                    if ($response.StatusCode -eq 200 -and $body.ok -eq $true) { $health = 'Healthy' }
                } finally { $reader.Dispose() }
            } finally { $response.Dispose() }
        }
    } catch { $health = 'NotReady' }
}
$taskInfo = $installed.Task | Get-ScheduledTaskInfo
[pscustomobject] @{
    TaskName = $installed.Task.TaskName
    TaskState = $installed.Task.State
    PID = $node.ProcessId
    Port = $settings.Port
    Health = $health
    LastTaskResult = $taskInfo.LastTaskResult
}

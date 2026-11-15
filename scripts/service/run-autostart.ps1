[CmdletBinding()]
param([Parameter(Mandatory)] [string] $Settings)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/task-settings.ps1"

$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Settings)) | ConvertFrom-Json
$env:FMCG_DATA_DIR = $config.DataDir
$env:FMCG_PORT = $config.Port
if ($config.ConfigFile) { $env:FMCG_LLM_CONFIG_FILE = $config.ConfigFile }
$logDir = Join-Path $config.DataDir 'state/runtime-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logDay = ''

function Write-LifecycleRecord([string] $message) {
    $today = [DateTime]::Today
    $day = $today.ToString('yyyy-MM-dd')
    if ($day -ne $script:logDay) {
        $oldest = $today.AddDays(-13).ToString('yyyy-MM-dd')
        Get-ChildItem -LiteralPath $logDir -Filter 'autostart-*.log' -File | ForEach-Object {
            if ($_.Name -match '^autostart-(\d{4}-\d{2}-\d{2})\.log$' -and $Matches[1] -lt $oldest) {
                Remove-Item -LiteralPath $_.FullName
            }
        }
        $script:logDay = $day
    }
    Add-Content -LiteralPath (Join-Path $logDir "autostart-$day.log") -Value "$([DateTimeOffset]::UtcNow.ToString('o')) $message"
}

$nodeArguments = "--import tsx server/index.ts --production --autostart-id $($config.Id)"
if ($config.UseProxy) {
    $env:PATH = (Split-Path $config.NodePath) + ';' + $env:PATH
    $proxyScript = Join-Path $repoRoot 'scripts/start_with_proxy.ps1'
    $executable = $windowsPowerShell
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $proxyScript + '" ' + $nodeArguments
} else {
    Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:ALL_PROXY, Env:NODE_USE_ENV_PROXY -ErrorAction SilentlyContinue
    $executable = $config.NodePath
    $arguments = $nodeArguments
}

# Only lifecycle data is persisted. Application output can contain user data.
$restartLimit = 3
$restartDelaySeconds = 60
$exitCode = 1
for ($attempt = 1; $attempt -le ($restartLimit + 1); $attempt++) {
    $process = $null
    try {
        Write-LifecycleRecord "Starting production process. Attempt $attempt of $($restartLimit + 1)."
        $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
        while (-not $process.WaitForExit(60000)) {
            if ([DateTime]::Today.ToString('yyyy-MM-dd') -ne $logDay) { Write-LifecycleRecord 'Production process still running.' }
        }
        $exitCode = $process.ExitCode
        Write-LifecycleRecord "Production process exited (code $exitCode)."
    } catch {
        if ($process -and -not $process.HasExited) {
            Stop-Process -InputObject $process
            if (-not $process.WaitForExit(5000)) { throw 'The production process did not exit.' }
        }
        Write-LifecycleRecord 'Production launcher failed.'
        $exitCode = 1
    }
    if ($exitCode -eq 0) { break }
    if ($config.UseProxy -and $process) { Stop-AipmAutostartChildren $config }
    if ($attempt -le $restartLimit) {
        Write-LifecycleRecord "Retrying production process in $restartDelaySeconds seconds ($attempt of $restartLimit)."
        Start-Sleep -Seconds $restartDelaySeconds
    }
}
exit $exitCode

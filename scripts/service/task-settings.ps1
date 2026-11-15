$repoRoot = Split-Path (Split-Path $PSScriptRoot)
$launcher = Join-Path $PSScriptRoot 'run-autostart.ps1'
$windowsPowerShell = (Get-Command powershell.exe -CommandType Application).Source
$commandPrefix = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "' +
    "& '" + $launcher.Replace("'", "''") + "' -Settings '"
$commandSuffix = '''; exit $LASTEXITCODE"'

function Get-AipmAutostartTask([string] $taskName) {
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue |
        Where-Object TaskName -EQ $taskName
    if (-not $task) { return }

    $action = $task.Actions
    if ($action.Count -ne 1 -or $action.Execute -ne $windowsPowerShell -or
        -not $action.Arguments.StartsWith($commandPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not $action.Arguments.EndsWith($commandSuffix, [StringComparison]::Ordinal)) {
        throw 'The named task does not belong to this AIPM Workspace installation.'
    }

    $encoded = $action.Arguments.Substring($commandPrefix.Length, $action.Arguments.Length - $commandPrefix.Length - $commandSuffix.Length)
    if ($encoded -notmatch '\A[A-Za-z0-9+/]+={0,2}\z') {
        throw 'The named task has invalid AIPM Workspace settings.'
    }
    $settings = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
    [pscustomobject] @{ Task = $task; Settings = $settings }
}

function Get-AipmAutostartProcess($settings, [switch] $ProxyWrapper) {
    # Each child keeps this argument in its command line for the lifetime of the process.
    $marker = '--autostart-id ' + ([guid] $settings.Id).ToString('N')
    $suffix = '(?:^|\s)' + [regex]::Escape($marker) + '\s*$'
    $executable = if ($ProxyWrapper) { $windowsPowerShell } else { $settings.NodePath }
    $name = Split-Path -Leaf $executable
    $proxyScript = Join-Path $repoRoot 'scripts/start_with_proxy.ps1'
    Get-CimInstance Win32_Process -Filter "Name = '$name' AND CommandLine LIKE '%$marker%'" |
        Where-Object {
            $_.ExecutablePath -eq $executable -and $_.CommandLine -match $suffix -and
                (-not $ProxyWrapper -or $_.CommandLine -match [regex]::Escape('-File "' + $proxyScript + '"'))
        }
}

function Stop-AipmAutostartChildren($settings) {
    # Stop a proxy wrapper before looking up Node so it cannot start another child.
    $lookups = if ($settings.UseProxy) { $true, $false } else { $false }
    foreach ($proxyWrapper in $lookups) {
        Get-AipmAutostartProcess $settings -ProxyWrapper:$proxyWrapper | ForEach-Object {
            $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
            if ($process) {
                Stop-Process -InputObject $process
                if (-not $process.WaitForExit(5000)) { throw 'The autostart child process did not exit.' }
            }
        }
    }
}

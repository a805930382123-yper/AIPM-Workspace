# No param block: all arguments are forwarded verbatim to Node (including --import).
$ErrorActionPreference = 'Stop'
$nodeHelp = (& node --help) -join "`n"
if ($LASTEXITCODE -ne 0 -or $nodeHelp -notmatch '(?m)^\s+--use-env-proxy\s') {
    throw 'Proxy startup requires Node with --use-env-proxy support. Upgrade to Node 24.5+ (or 22.21+); ordinary npm run dev remains available.'
}

if (-not $env:HTTP_PROXY -and -not $env:HTTPS_PROXY) {
    $proxySettings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($proxySettings.ProxyEnable -eq 1 -and $proxySettings.ProxyServer) {
        $proxyServer = $proxySettings.ProxyServer.Trim()
        if ($proxyServer.Contains('=')) {
            foreach ($entry in $proxyServer.Split(';')) {
                $parts = $entry.Trim() -split '=', 2
                if ($parts.Length -eq 2 -and $parts[0] -in @('http', 'https')) {
                    $proxyAddress = $parts[1].Trim()
                    if ($proxyAddress -and $proxyAddress -notmatch '://') { $proxyAddress = 'http://' + $proxyAddress }
                    if ($parts[0] -eq 'http') { $env:HTTP_PROXY = $proxyAddress }
                    else { $env:HTTPS_PROXY = $proxyAddress }
                }
            }
        } else {
            if ($proxyServer -notmatch '://') { $proxyServer = 'http://' + $proxyServer }
            $env:HTTP_PROXY = $proxyServer
            $env:HTTPS_PROXY = $proxyServer
        }
    }
}
if (-not $env:HTTP_PROXY -and -not $env:HTTPS_PROXY) {
    throw 'No HTTP/HTTPS proxy found. Set HTTP_PROXY / HTTPS_PROXY or enable a Windows manual HTTP proxy, then run this command again.'
}

# Inherit the native flag through npm, concurrently and tsx child processes too.
$env:NODE_OPTIONS = ($env:NODE_OPTIONS + ' --use-env-proxy').Trim()
if ($args.Count -gt 0) {
    & node @args
} else {
    & npm.cmd run dev
}
exit $LASTEXITCODE

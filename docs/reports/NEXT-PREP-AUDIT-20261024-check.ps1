$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$deliveries = @('docs/reports/NEXT-PREP-20261024-gap-map.md','docs/reports/NEXT-PREP-20261024-builder.md','docs/handoffs/NEXT-PREP-20261024-next-task.md')
$hashes = @($deliveries | ForEach-Object { [pscustomobject]@{path=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLower()} })
$broken = @()
foreach ($file in $deliveries) {
 $content=Get-Content -LiteralPath $file -Raw
 foreach ($m in [regex]::Matches($content,'\]\(([^)]+)\)')) {
  $target=$m.Groups[1].Value -replace '#.*$',''
  if (!$target -or $target -match '^(https?:|mailto:|codex:)') { continue }
  $resolved=Join-Path (Split-Path -Parent $file) $target
  if (!(Test-Path -LiteralPath $resolved)) { $broken += [pscustomobject]@{file=$file;target=$target} }
 }
}
$rows=@(Get-Content docs/delivery-matrix.md | Where-Object {$_ -match '^\| [AR]\d+ \|'})
$counts=@{}
foreach ($row in $rows) { $state=($row -split '\|')[4].Trim(); $counts[$state]=1+$counts[$state] }
$gap=Get-Content $deliveries[0] -Raw
$missingUnpassed=@($rows | Where-Object {($_ -split '\|')[4].Trim() -ne 'PASS'} | ForEach-Object {($_ -split '\|')[1].Trim()} | Where-Object {$gap -notmatch ('\b'+$_+'\b')})
$pa=Get-Content docs/reports/PA01-RECHECK-20261016-main-frozen.json -Raw | ConvertFrom-Json
$paChanged=@($pa.product.psobject.Properties | Where-Object {(Get-FileHash -LiteralPath $_.Name -Algorithm SHA256).Hash.ToLower() -ne $_.Value} | ForEach-Object Name)
$human=Get-Content docs/reports/KB02-HUMAN-AUDIT-20261023-engineering.json -Raw | ConvertFrom-Json
$humanChanged=@($human.expected.psobject.Properties | Where-Object {(Get-FileHash -LiteralPath $_.Name -Algorithm SHA256).Hash.ToLower() -ne $_.Value} | ForEach-Object Name)
$c=Get-Content docs/reports/KB02-K204-C-20261024-freeze.json -Raw | ConvertFrom-Json
$cChanged=@($c.files | Where-Object {(Get-FileHash -LiteralPath $_.path -Algorithm SHA256).Hash.ToLower() -ne $_.sha256} | ForEach-Object path)
$r=[ordered]@{at=[DateTime]::UtcNow.ToString('o');command='pwsh -NoProfile -File docs/reports/NEXT-PREP-AUDIT-20261024-check.ps1';head=(git rev-parse HEAD);deliveryHashes=$hashes;brokenLinks=$broken;historicalMatrixCount=$rows.Count;historicalMatrixStates=$counts;unpassedIdsNotLiterallyNamed=$missingUnpassed;pa01FrozenCount=@($pa.product.psobject.Properties).Count;pa01Changed=$paChanged;humanFrozenCount=@($human.expected.psobject.Properties).Count;humanChanged=$humanChanged;stageCFrozenCount=@($c.files).Count;stageCChanged=$cChanged;matrixHash=(Get-FileHash docs/delivery-matrix.md -Algorithm SHA256).Hash.ToLower();realCalls=0;knowledgeCumulative=241;promptCumulative=15;productTests='NOT_RUN';nextCardExecution='NOT_RUN'}
$r | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath docs/reports/NEXT-PREP-AUDIT-20261024-check.json -Encoding utf8
$r | ConvertTo-Json -Depth 8
if ($broken.Count -or $humanChanged.Count -or $cChanged.Count) { exit 1 }


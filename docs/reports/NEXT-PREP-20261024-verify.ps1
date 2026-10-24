param()
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $root
function Digest([string]$relative) {
  if ($relative -match '(^|[\\/])(\.env\.local|workspace)([\\/]|$)') { throw "Forbidden path: $relative" }
  $absolute = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (-not $absolute.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Outside root: $relative" }
  return (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
}
function CompareMap($name, $map) {
  $same = @(); $changed = @(); $missing = @()
  foreach ($p in $map.PSObject.Properties) {
    if (-not (Test-Path -LiteralPath $p.Name -PathType Leaf)) { $missing += $p.Name }
    elseif ((Digest $p.Name) -eq $p.Value) { $same += $p.Name }
    else { $changed += $p.Name }
  }
  return [pscustomobject]@{ name=$name; total=@($map.PSObject.Properties).Count; sameCount=$same.Count; same=$same; changed=$changed; missing=$missing }
}
$c = Get-Content -LiteralPath docs/reports/KB02-K204-C-20261024-freeze.json -Raw | ConvertFrom-Json
$cChanged = @($c.files | Where-Object { (Digest $_.path) -ne $_.sha256 })
if ($cChanged.Count) { throw 'C frozen source drift' }
$pa = Get-Content -LiteralPath docs/reports/PA01-RECHECK-20261016-main-frozen.json -Raw | ConvertFrom-Json
$full = Get-Content -LiteralPath docs/reports/FULL3-20261014-frozen.json -Raw | ConvertFrom-Json
$human = Get-Content -LiteralPath docs/reports/KB02-HUMAN-AUDIT-20261023-engineering.json -Raw | ConvertFrom-Json
$comparisons = @((CompareMap 'PA01' $pa.product), (CompareMap 'FULL3' $full.product), (CompareMap 'HUMAN188' $human.expected))
$oldRows = @(Get-Content -LiteralPath docs/reports/FULL3-20261014-spec-matrix.md | Where-Object { $_ -match '^\| (A\d+|R\d+) ' })
$ids = @($oldRows | ForEach-Object { ([regex]::Match($_,'^\| (A\d+|R\d+) ')).Groups[1].Value })
if ($ids.Count -ne 109 -or @($ids | Sort-Object -Unique).Count -ne 109) { throw 'Old matrix ID inventory mismatch' }
$oldNonPass = @($oldRows | Where-Object { $_ -notmatch '\| PASS \| PASS \|' } | ForEach-Object { ([regex]::Match($_,'^\| (A\d+|R\d+) ')).Groups[1].Value })
$gap = Get-Content -LiteralPath docs/reports/NEXT-PREP-20261024-gap-map.md -Raw
foreach ($id in $ids) { if ($gap -notmatch ('(?<![A-Z0-9])'+$id+'(?![0-9])')) { throw "Unmapped historical non-pass: $id" } }
$docs = @('docs/reports/NEXT-PREP-20261024-gap-map.md','docs/reports/NEXT-PREP-20261024-builder.md','docs/handoffs/NEXT-PREP-20261024-next-task.md')
$linkResults = @()
foreach ($doc in $docs) {
  $body = Get-Content -LiteralPath $doc -Raw
  foreach ($m in [regex]::Matches($body,'\[[^\]]+\]\(([^)]+)\)')) {
    $target = $m.Groups[1].Value
    if ($target -match '^(https?:|#)') { continue }
    $clean = ($target -split '#')[0]
    $resolved = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent (Join-Path $root $doc)) $clean))
    $exists = Test-Path -LiteralPath $resolved -PathType Leaf
    $linkResults += [pscustomobject]@{ document=$doc; target=$target; exists=$exists }
    if (-not $exists) { throw "Broken local link: $doc -> $target" }
  }
}
$sourcePaths = @('docs/delivery-matrix.md','docs/reports/FULL3-20261014-spec-matrix.md','docs/reports/FULL3-20261014-acceptance.md','docs/reports/PA01-CONTINUE-20261016-acceptance.md','docs/reports/KB02-HUMAN-CLOSE-20261023-acceptance.md','docs/reports/KB02-K204-A-AUDIT-20261023-resume-final.md','docs/reports/KB02-K204-BR-AUDIT-20261024-final.md','docs/reports/KB02-K204-C-AUDIT-20261024-final.md','docs/reports/KB02-K204-C-AUDIT-20261024-final-check.json')
$sources = @($sourcePaths | ForEach-Object { [pscustomobject]@{path=$_;sha256=(Digest $_)} })
$productDiff = @(git diff --name-only 60f83adba102d887fcd925df13a8021ff7669de1 -- app services server rules package.json package-lock.json)
if ($LASTEXITCODE -ne 0 -or $productDiff.Count) { throw 'Product differs from declared commit' }
$result = [ordered]@{
  kind='offline-document-and-freeze-check'; at=(Get-Date).ToUniversalTime().ToString('o')
  head=(git rev-parse HEAD).Trim(); productCommit='60f83adba102d887fcd925df13a8021ff7669de1'
  realCalls=0; servicesStarted=0; configRead=$false; formalWorkspaceRead=$false
  cFreeze=[ordered]@{path='docs/reports/KB02-K204-C-20261024-freeze.json';sha256=(Digest 'docs/reports/KB02-K204-C-20261024-freeze.json');count=$c.files.Count;changed=$cChanged}
  comparisons=$comparisons; historicalIds=$ids; historicalNonPass=$oldNonPass
  localLinks=$linkResults; protectedEvidence=$sources; productDiff=$productDiff
  documents=@($docs | ForEach-Object { [pscustomobject]@{path=$_;sha256=(Digest $_)} })
  note='Historical matrix enumeration only; no current product PASS counts. This command does not run product tests or consume models.'
}
$out = Join-Path $root 'docs/reports/NEXT-PREP-20261024-checks.json'
$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $out -Encoding utf8NoBOM
[pscustomobject]@{cCount=$c.files.Count;cMismatch=$cChanged.Count;compares=@($comparisons | Select-Object name,sameCount,@{n='changedCount';e={$_.changed.Count}});historicalIds=$ids.Count;historicalNonPass=$oldNonPass.Count;links=$linkResults.Count;brokenLinks=0;realCalls=0;output='docs/reports/NEXT-PREP-20261024-checks.json'} | ConvertTo-Json -Depth 6




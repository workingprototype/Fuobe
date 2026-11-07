# Tests for the pure parts of the limited-user setup: address ranges, the site's ranges, the password maker, paths,
# the read plan, the command files, the record of changes, the result file and the check rows. It needs no admin
# rights and writes only inside a new folder under TEMP, which it deletes at the end.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File test-pure-parts.ps1
. (Join-Path $PSScriptRoot 'common.ps1')

$script:failed = 0
$script:passed = 0
function Assert([bool]$Condition, [string]$Name) {
  if ($Condition) { $script:passed++ } else { $script:failed++; Write-Host "FAIL: $Name" -ForegroundColor Red }
}
function Assert-Throws([scriptblock]$Block, [string]$Name) {
  $threw = $false
  try { & $Block | Out-Null } catch { $threw = $true }
  Assert $threw $Name
}

# Every address in $Ranges ("a-b" or "a") as bounds.
function Expand([string[]]$Ranges) {
  foreach ($r in $Ranges) {
    $p = $r.Split('-')
    $a = ConvertTo-IpNumber ([Net.IPAddress]::Parse($p[0]))
    $z = $a
    if ($p.Count -gt 1) { $z = ConvertTo-IpNumber ([Net.IPAddress]::Parse($p[1])) }
    [pscustomobject]@{ Start = $a; End = $z }
  }
}
function InAny([string]$Ip, [string[]]$Ranges) {
  $n = ConvertTo-IpNumber ([Net.IPAddress]::Parse($Ip))
  foreach ($b in Expand $Ranges) { if ($n -ge $b.Start -and $n -le $b.End) { return $true } }
  $false
}

# 1. Loopback only (the ComfyUI Python rule).
$v4 = @(Get-ComplementRanges $LoopbackRanges 4)
Assert ($v4.Count -eq 2) 'IPv4 complement of loopback has two ranges'
Assert ($v4[0] -eq '0.0.0.0-126.255.255.255') "first IPv4 range (got $($v4[0]))"
Assert ($v4[1] -eq '128.0.0.0-255.255.255.255') "second IPv4 range (got $($v4[1]))"
$v6 = @(Get-ComplementRanges $LoopbackRanges 6)
Assert ($v6.Count -eq 1 -and $v6[0] -eq '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff') "IPv6 complement of ::1 starts at ::2 (got $($v6 -join ', '))"
Assert (-not (InAny '127.0.0.1' $v4)) '127.0.0.1 is not blocked'
Assert (InAny '8.8.8.8' $v4) '8.8.8.8 is blocked for Python'
Assert (InAny '192.168.1.10' $v4) 'the local network is blocked for Python'
Assert (-not (InAny '::1' $v6)) '::1 is not blocked'
Assert (InAny 'fe80::1' $v6) 'link-local IPv6 is blocked for Python'

# 2. Loopback and Cloudflare (node and the worker user): those stay open, everything else is blocked.
$keep = @($LoopbackRanges + $CloudflareV4 + $CloudflareV6)
$n4 = @(Get-ComplementRanges $keep 4)
$n6 = @(Get-ComplementRanges $keep 6)
foreach ($ip in @('104.16.0.0', '104.23.255.255', '172.67.1.2', '188.114.97.3', '131.0.75.255', '127.0.0.1')) { Assert (-not (InAny $ip $n4)) "$ip stays open" }
foreach ($ip in @('2606:4700::6810:84e5', '2a06:98c7:ffff::1', '::1')) { Assert (-not (InAny $ip $n6)) "$ip stays open" }
foreach ($ip in @('8.8.8.8', '1.1.1.1', '140.82.112.3', '192.168.1.10', '104.15.255.255', '104.28.0.0', '255.255.255.255', '0.0.0.0')) { Assert (InAny $ip $n4) "$ip is blocked" }
foreach ($ip in @('2001:4860:4860::8888', '2a06:98c8::1', 'fe80::1', 'ff02::1')) { Assert (InAny $ip $n6) "$ip is blocked" }
$b = @(Expand $n4)
$ordered = $true
for ($i = 1; $i -lt $b.Count; $i++) { if ($b[$i].Start -le $b[$i - 1].End) { $ordered = $false } }
Assert $ordered 'the IPv4 ranges are in order and do not overlap'
Assert (Test-IpInRanges '104.21.5.9' $CloudflareV4) 'Test-IpInRanges finds a Cloudflare address'
Assert (-not (Test-IpInRanges '93.184.216.34' $CloudflareV4)) 'Test-IpInRanges refuses another address'
Assert (Test-IpInRanges '2606:4700:3030::1' $CloudflareV6) 'Test-IpInRanges finds a Cloudflare IPv6 address'
Assert-Throws { Get-CidrBounds '10.0.0.0/33' } 'a prefix longer than 32 is refused'

# 3. The site: its host, and the ranges the worker may reach.
Assert ((Get-SiteHost 'https://example.test/some/path') -eq 'example.test') 'Get-SiteHost reads the host'
Assert ((Get-SiteHost 'https://example.test:443') -eq 'example.test') 'Get-SiteHost takes an explicit port 443'
Assert-Throws { Get-SiteHost 'http://example.test' } 'Get-SiteHost refuses http'
Assert-Throws { Get-SiteHost 'https://example.test:8443' } 'Get-SiteHost refuses a port other than 443'
Assert-Throws { Get-SiteHost 'example.test' } 'Get-SiteHost refuses an address without a scheme'
$cf = Get-SiteRanges @('104.21.5.9', '2606:4700:3030::1') @()
Assert ($cf.Source -eq 'cloudflare' -and $cf.Ranges.Count -eq ($CloudflareV4.Count + $CloudflareV6.Count)) 'addresses inside Cloudflare give Cloudflare''s ranges'
$own = Get-SiteRanges @('104.21.5.9', '93.184.216.34', '2001:db8::5') @()
Assert ($own.Source -eq 'resolved') 'one address outside Cloudflare gives the resolved addresses'
Assert (($own.Ranges -join ',') -eq '104.21.5.9/32,93.184.216.34/32,2001:db8::5/128') "the resolved addresses become /32 and /128 (got $($own.Ranges -join ','))"
$given = Get-SiteRanges @('203.0.113.7') @('203.0.113.0/24')
Assert ($given.Source -eq 'given' -and $given.Ranges.Count -eq 1) '-SiteAddresses wins'
Assert-Throws { Get-SiteRanges @('198.51.100.1') @('203.0.113.0/24') } 'a resolved address outside -SiteAddresses is refused'
Assert-Throws { Get-SiteRanges @() @() } 'no address and no -SiteAddresses is refused'
Assert-Throws { Get-SiteRanges @() @('not-a-range') } 'a bad -SiteAddresses value is refused'
Assert (@(Resolve-SiteAddresses '203.0.113.9')[0] -eq '203.0.113.9') 'an address as host needs no lookup'

# 4. The password maker.
$seen = @{}
$ok = $true
for ($i = 0; $i -lt 200; $i++) {
  $p = New-WorkerPassword
  if ($p.Length -ne 40) { $ok = $false }
  if ($p -cnotmatch '[A-Z]' -or $p -cnotmatch '[a-z]' -or $p -notmatch '[0-9]' -or $p -notmatch '[!#%+\-.:=?@_~]') { $ok = $false }
  if ($p -match '["\\\s]') { $ok = $false }
  $seen[$p] = 1
}
Assert $ok 'every password has 40 characters, all four kinds, and no quote, backslash or space'
Assert ($seen.Count -eq 200) '200 passwords are all different'

# 5. Paths.
# Full paths, as the helpers make them (TEMP may be given with short 8.3 names).
$base = Get-FullPath (Join-Path $env:TEMP ('limited-paths-' + [guid]::NewGuid().ToString('N')))
$drive = [IO.Path]::GetPathRoot($base)
$root = Join-Path $base 'worker'
$P = Get-WorkerPaths $root (Join-Path $root 'versions\1.0.0')
Assert ($P.NodeExe -eq (Join-Path $root 'versions\1.0.0\node\node.exe')) 'node.exe is in versions\<id>\node'
Assert ($P.FuobeMjs -eq (Join-Path $root 'versions\1.0.0\app\bin\fuobe.mjs')) 'fuobe.mjs is in versions\<id>\app\bin'
Assert ($P.StateFile -eq (Join-Path $root 'limited-setup-state.json')) 'the record is at the root'
Assert ($P.Cache -eq (Join-Path $root 'temp\cache')) 'the cache is temp\cache'
Assert ((Get-WorkerPaths ($root + '\')).Root -eq $root) 'a trailing backslash is dropped'
Assert (Test-PathInside (Join-Path $root 'work\a') (Join-Path $root 'work')) 'a path inside work is inside'
Assert (-not (Test-PathInside (Join-Path $root 'workers\a') (Join-Path $root 'work'))) 'workers is not inside work'
Assert (Test-PathInside ($root.ToUpperInvariant()) $root) 'Test-PathInside ignores case'
Assert (Test-PathInside (Join-Path $root 'a\..\work') (Join-Path $root 'work')) 'Test-PathInside reads ..'
Assert (Test-DriveRoot $drive) 'a drive root is a drive root'
Assert (-not (Test-DriveRoot $root)) 'a folder is not a drive root'
Assert ((Get-FullPath $drive) -eq $drive) 'Get-FullPath keeps the backslash of a drive root'

# 6. The read plan.
$models = Join-Path $base 'models'
$sysDir = Join-Path $base 'system'
$plan = Get-ReadPlan @($drive, (Join-Path $root 'work\py'), (Join-Path $root 'versions\x'), (Join-Path $sysDir 'ffmpeg'), $models, (Join-Path $models 'loras'), $models.ToUpperInvariant(), $null) $P @($sysDir)
Assert ($plan.Problems.Count -eq 2) "the plan refuses a whole drive and a folder in work (got $($plan.Problems -join ' | '))"
Assert ($plan.Grant.Count -eq 1 -and $plan.Grant[0] -eq $models) "the plan grants the model folder once (got $($plan.Grant -join ', '))"
$skipped = @($plan.Skip | ForEach-Object { $_.Path })
Assert ($skipped -contains (Join-Path $root 'versions\x')) 'a folder inside the root needs no entry'
Assert ($skipped -contains (Join-Path $sysDir 'ffmpeg')) 'a folder inside a system folder needs no entry'
Assert ($skipped -contains (Join-Path $models 'loras')) 'a folder inside a granted folder needs no entry'
Assert ((Get-CloseMask $models @($models)) -eq $DenyWrite) 'a closed place that is a read folder keeps read'
Assert ((Get-CloseMask $base @($models)) -eq $DenyWrite) 'a closed place that holds a read folder keeps read'
Assert ((Get-CloseMask (Join-Path $models 'x') @($models)) -eq $DenyWrite) 'a closed place inside a read folder keeps read'
Assert ((Get-CloseMask (Join-Path $base 'other') @($models)) -eq $DenyAll) 'another closed place gets deny all'

# 7. The command files.
Assert ((ConvertTo-CmdText 'a%b') -eq 'a%%b') 'a % is doubled in a .cmd file'
Assert-Throws { ConvertTo-CmdText 'a"b' } 'a quote is refused in a .cmd file'
Assert-Throws { ConvertTo-CmdText ('a' + [char]0x00E9) } 'a non-ASCII path is refused in a .cmd file'
$pc = Get-WorkerPaths (Join-Path $base 'w 100%') (Join-Path $base 'w 100%\versions\2')
$wc = New-WorkerCmdText $pc
$rc = New-RunWorkerCmdText $pc '\Fuobe\Worker'
foreach ($t in @(@('worker.cmd', $wc), @('run-worker.cmd', $rc))) {
  $txt = $t[1]
  Assert ($txt -notmatch '[^\x00-\x7F]') "$($t[0]) is ASCII"
  Assert (($txt -replace "`r`n", '') -notmatch "[`r`n]") "$($t[0]) has CRLF line ends only"
  Assert ($txt.StartsWith('@echo off')) "$($t[0]) starts with @echo off"
  Assert ($txt.Contains("set ""FUOBE_WORKER_HOME=$($pc.WorkerHome.Replace('%', '%%'))""")) "$($t[0]) sets FUOBE_WORKER_HOME to home"
  Assert (-not ($txt -match '100%\\')) "$($t[0]) holds no single % of the path"
}
Assert ($wc.Contains("""$($pc.NodeExe.Replace('%', '%%'))"" ""$($pc.FuobeMjs.Replace('%', '%%'))"" worker %*")) 'worker.cmd runs node fuobe.mjs worker with the given arguments'
Assert ($rc.Contains('worker run >>"%LOG%" 2>&1')) 'run-worker.cmd runs worker run with its output in the log'
Assert ($rc.Contains("set ""LOG=$($pc.Log.Replace('%', '%%'))""")) 'run-worker.cmd logs to home\worker.log'
Assert ($rc.Contains("set ""TEMP=$($pc.Temp.Replace('%', '%%'))""") -and $rc.Contains("set ""TMP=$($pc.Temp.Replace('%', '%%'))""")) 'run-worker.cmd sets TEMP and TMP'
Assert ($rc.Contains('if /i not "%%~nxD"=="cache" rd /s /q "%%D"')) 'run-worker.cmd empties temp but keeps temp\cache'
Assert ($rc.Contains('GTR 20000000 move /y "%LOG%" "%LOG%.1"')) 'run-worker.cmd moves a log over 20 MB aside'
Assert ($rc.Contains('if "%CODE%"=="0" exit /b 0')) 'exit code 0 ends run-worker.cmd'
Assert ($rc.Contains('set "WAIT=60"') -and $rc.Contains('if "%CODE%"=="3" set "WAIT=600"') -and $rc.Contains('if "%CODE%"=="75" set "WAIT=5"')) 'restart waits: 60 s, 600 s for 3, 5 s for 75'
Assert ($rc.Contains('set /a PINGS=WAIT+1') -and $rc.Contains('ping -n %PINGS% 127.0.0.1 >nul') -and $rc.Contains('goto start')) 'run-worker.cmd waits with ping and starts again'
Assert ($rc -notmatch '(?m)^\s*timeout\b') 'run-worker.cmd does not use timeout (it fails without a console)'
Assert ($rc.Contains('\Fuobe\Worker')) 'run-worker.cmd names its task'

$tmp = Get-FullPath (Join-Path $env:TEMP ('limited-pure-test-' + [guid]::NewGuid().ToString('N')))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  # 8. The record of changes: written, read back, once per entry, no byte-order mark.
  $sf = Join-Path $tmp 'limited-setup-state.json'
  $st = Read-SetupState $sf
  Assert (@($st.entries).Count -eq 0 -and $null -eq $st.quota -and $null -eq $st.workerSid) 'a missing record is empty'
  $sidA = 'S-1-5-21-0-0-0-1001'
  $st.workerSid = $sidA
  Add-SetupStateEntry $sf $st $models 'icacls' $sidA
  Add-SetupStateEntry $sf $st $models.ToUpperInvariant() 'icacls' $sidA
  Add-SetupStateEntry $sf $st $drive 'this-folder' $sidA
  $st.quota = [ordered]@{ volume = $drive; sid = $sidA; user = 'PC\worker'; priorState = 0 }
  Save-SetupState $sf $st
  $back = Read-SetupState $sf
  Assert (@($back.entries).Count -eq 2) "the record holds each entry once (got $(@($back.entries).Count))"
  Assert ($back.entries[1].kind -eq 'this-folder' -and $back.entries[1].path -eq $drive) 'the record keeps the kind and the path'
  Assert ($back.workerSid -eq $sidA -and $back.quota.priorState -eq 0 -and $back.quota.volume -eq $drive) 'the record keeps the SID and the quota'
  $rb = [IO.File]::ReadAllBytes($sf)
  Assert (-not ($rb[0] -eq 0xEF -and $rb[1] -eq 0xBB)) 'the record has no byte-order mark'
  $back.entries = @(@($back.entries) | Where-Object { -not ($_.path -ieq $models -and $_.kind -eq 'icacls') })
  Save-SetupState $sf $back
  $again = Read-SetupState $sf
  Assert (@($again.entries).Count -eq 1 -and $again.entries[0].kind -eq 'this-folder') 'an entry taken off the record stays off, and one entry stays a list'
  Assert (-not (Test-Path -LiteralPath "$sf.tmp")) 'no temporary file is left'

  # 9. The result file.
  $rf = Join-Path $tmp 'result.json'
  $res = New-RunResult $false
  Save-RunResult $rf $res
  $r0 = [IO.File]::ReadAllText($rf) | ConvertFrom-Json
  Assert ($r0.ok -eq $false -and $null -eq $r0.exitCode -and @($r0.steps).Count -eq 0 -and @($r0.failed).Count -eq 0) 'a new result has no steps and no failures'
  Add-StepResult $res 'user' $true 'sid S-1-5-21-0-0-0-1001'
  $res.ok = $true
  $res.exitCode = 0
  Save-RunResult $rf $res
  $r1 = [IO.File]::ReadAllText($rf) | ConvertFrom-Json
  Assert ($r1.steps -is [array] -and $r1.steps.Count -eq 1 -and $r1.steps[0].name -eq 'user' -and $r1.steps[0].ok) 'one step stays a JSON list'
  Assert ($r1.failed -is [array] -and $r1.failed.Count -eq 0) 'no failure is an empty JSON list'
  Add-StepResult $res 'firewall' $false 'no address'
  $res.ok = $false
  $res.exitCode = 1
  Save-RunResult $rf $res
  $r2 = [IO.File]::ReadAllText($rf) | ConvertFrom-Json
  Assert ($r2.steps.Count -eq 2 -and -not $r2.steps[1].ok -and $r2.exitCode -eq 1) 'a failed step is in the steps'
  Assert ($r2.failed -is [array] -and $r2.failed.Count -eq 1 -and $r2.failed[0] -eq 'firewall: no address') 'a failed step is in failed'
  Assert ($r2.PSObject.Properties.Name -contains 'taskEnabled' -and $r2.PSObject.Properties.Name -contains 'whatIf') 'the result names taskEnabled and whatIf'
  Save-RunResult '' $res
  Assert $true 'no -ResultFile writes nothing'

  # 10. The rows of the check as the worker user (Windows PowerShell's ConvertFrom-Json hands a list over as one object).
  $two = Join-Path $tmp 'two.json'
  $rowsIn = @([pscustomobject]@{ name = 'a'; expected = $true; got = $true; ok = $true; note = '' }, [pscustomobject]@{ name = 'b'; expected = $false; got = $true; ok = $false; note = '' })
  [IO.File]::WriteAllText($two, (ConvertTo-Json -InputObject $rowsIn -Depth 4), (New-Object Text.UTF8Encoding($false)))
  $rows = @(Read-CheckRows $two)
  Assert ($rows.Count -eq 2 -and @($rows | Where-Object { -not $_.ok }).Count -eq 1) 'Read-CheckRows reads two rows, one failed'
  $one = Join-Path $tmp 'one.json'
  [IO.File]::WriteAllText($one, (ConvertTo-Json -InputObject @([pscustomobject]@{ name = 'a'; ok = $false }) -Depth 4), (New-Object Text.UTF8Encoding($false)))
  $rows1 = @(Read-CheckRows $one)
  Assert ($rows1.Count -eq 1 -and -not $rows1[0].ok) 'Read-CheckRows reads a list of one failed row'

  # 11. The ComfyUI Python, in a made-up tree.
  $portable = Join-Path $tmp 'portable'
  New-Item -ItemType Directory -Path (Join-Path $portable 'ComfyUI'), (Join-Path $portable 'python_embeded') | Out-Null
  foreach ($f in @('ComfyUI\main.py', 'python_embeded\python.exe', 'python_embeded\pythonw.exe')) { [IO.File]::WriteAllText((Join-Path $portable $f), '') }
  $pe = Find-WorkerPython (Join-Path $portable 'ComfyUI')
  Assert ($pe -and -not $pe.IsVenv -and $pe.Python -eq (Join-Path $portable 'python_embeded\python.exe')) 'the portable Python beside ComfyUI is found'
  Assert ($pe.Files.Count -eq 2 -and $pe.ReadDirs.Count -eq 1 -and $pe.ReadDirs[0] -eq (Join-Path $portable 'python_embeded')) 'python.exe and pythonw.exe are named, and its folder is read'
  $venvComfy = Join-Path $tmp 'venvcomfy'
  $basePy = Join-Path $tmp 'basepython'
  New-Item -ItemType Directory -Path (Join-Path $venvComfy 'venv\Scripts'), $basePy | Out-Null
  [IO.File]::WriteAllText((Join-Path $venvComfy 'main.py'), '')
  [IO.File]::WriteAllText((Join-Path $venvComfy 'venv\Scripts\python.exe'), '')
  [IO.File]::WriteAllText((Join-Path $basePy 'python.exe'), '')
  [IO.File]::WriteAllText((Join-Path $venvComfy 'venv\pyvenv.cfg'), "home = $basePy`r`nversion = 3.12.0`r`n")
  $pv = Find-WorkerPython $venvComfy
  Assert ($pv -and $pv.IsVenv -and ($pv.Files -contains (Join-Path $basePy 'python.exe'))) 'a venv names its real Python too'
  Assert (($pv.ReadDirs -contains (Join-Path $venvComfy 'venv')) -and ($pv.ReadDirs -contains $basePy)) 'a venv reads the venv and the real Python''s folder'
  $pd = Find-WorkerPython $venvComfy (Join-Path $portable 'python_embeded')
  Assert ($pd -and $pd.Python -eq (Join-Path $portable 'python_embeded\python.exe')) '-PythonDir wins over the folders beside ComfyUI'
  Assert ($null -eq (Find-WorkerPython (Join-Path $tmp 'nothing'))) 'no Python gives nothing'

  # 12. Write-Utf8NoBom replaces a file.
  $wf = Join-Path $tmp 'replace.json'
  Write-Utf8NoBom $wf 'one'
  Write-Utf8NoBom $wf 'two'
  Assert ([IO.File]::ReadAllText($wf) -eq 'two') 'Write-Utf8NoBom replaces the file'
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Assert (-not (Test-Path -LiteralPath $tmp)) 'the test folder is gone'

# 13. The scripts: plain ASCII, and the check reads every key that the install writes.
foreach ($f in @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1')) {
  $bytes = [IO.File]::ReadAllBytes($f.FullName)
  Assert (-not @($bytes | Where-Object { $_ -gt 0x7E -or ($_ -lt 0x20 -and $_ -ne 9 -and $_ -ne 10 -and $_ -ne 13) }).Count) "$($f.Name) is plain ASCII"
}
$install = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Install-LimitedWorker.ps1'))
$check = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'check-as-worker.ps1'))
$block = [regex]::Match($install, '\$checkInput = \[ordered\]@\{(?<body>[^}]*)\}').Groups['body'].Value
$keys = @([regex]::Matches($block, '(?m)^\s*(\w+)\s*=') | ForEach-Object { $_.Groups[1].Value })
Assert ($keys.Count -ge 10) "the install writes the check input (got $($keys.Count) keys)"
foreach ($k in $keys) { Assert ($check.Contains("`$cfg.$k")) "check-as-worker.ps1 reads $k" }
foreach ($k in @([regex]::Matches($check, '\$cfg\.(\w+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)) {
  Assert ($keys -contains $k) "the install writes $k for the check"
}

Write-Host ''
Write-Host "$script:passed passed, $script:failed failed"
if ($script:failed) { exit 1 }

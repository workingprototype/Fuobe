# Runs AS THE WORKER USER, once, from a short-lived scheduled task that Install-LimitedWorker.ps1 makes and removes.
# The install copies this file and its input (check-input.json) into <root>\bin, where the worker user can read them
# but not change them.
# It reports whether the rights and the firewall work for that user: what it can read, what it cannot write, whether
# it sees the GPU counters and the port table, whether the worker's node.exe reaches the site, and whether it, the
# worker's python.exe and node.exe are kept off the rest of the internet. It writes only small test files and folders
# that it deletes again, and contacts only this PC, the site and the probe host (which it must NOT reach). The result
# goes to -Out as JSON. It never reads worker.json.
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
$results = New-Object System.Collections.Generic.List[object]

# One row. $Expected $null: information only. -Strict: an error in the test is a problem, also for a row that expects
# "cannot" (a network probe that did not run says nothing about the network).
function Add-Result([string]$Name, $Expected, [scriptblock]$Test, [switch]$Strict) {
  $got = $null
  $note = ''
  $failed = $false
  try { $got = & $Test } catch { $got = $false; $note = $_.Exception.Message; $failed = $true }
  $ok = ($null -eq $Expected) -or ([bool]$got -eq [bool]$Expected)
  if ($Strict -and $failed) { $ok = $false }
  $results.Add([pscustomobject]@{ name = $Name; expected = $Expected; got = $got; ok = $ok; note = $note })
}

function Save-Results {
  $json = ConvertTo-Json -InputObject @($results.ToArray()) -Depth 4
  [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding($false)))
}

# True when this user can make a file or a folder in $Dir. It deletes what it made.
function Test-CanCreate([string]$Dir) {
  $name = 'limited-check-' + [guid]::NewGuid().ToString('N')
  $f = Join-Path $Dir ($name + '.tmp')
  try {
    [IO.File]::WriteAllText($f, 'check')
    Remove-Item -LiteralPath $f -Force
    return $true
  } catch { }
  $d = Join-Path $Dir $name
  try {
    [IO.Directory]::CreateDirectory($d) | Out-Null
    Remove-Item -LiteralPath $d -Force
    return $true
  } catch { }
  $false
}

function Test-CanList([string]$Dir) {
  try { [IO.Directory]::GetFileSystemEntries($Dir) | Out-Null; $true } catch [UnauthorizedAccessException] { $false }
}

function Test-Tcp([string]$Address, [int]$Port) {
  $ip = [Net.IPAddress]::Parse($Address)
  $c = New-Object Net.Sockets.TcpClient($ip.AddressFamily)
  try { $t = $c.ConnectAsync($ip, $Port); if (-not $t.Wait(5000)) { return $false }; $c.Connected } catch { $false } finally { $c.Dispose() }
}

# Runs a probe program that prints "loop=0|1" (it reached a listener on 127.0.0.1), "out=0|1" (it reached the probe
# address on port 443) and "site=0|1" (it reached the site on port 443). Returns those, with $null for a line that
# did not come.
function Invoke-NetProbe([string]$Exe, [string[]]$ArgList) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $lines = @(& $Exe @ArgList 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $old }
  $r = @{ loop = $null; out = $null; site = $null; text = (($lines | Select-Object -Last 3) -join ' ') }
  foreach ($line in $lines) { if ($line -match '^(loop|out|site)=([01])\s*$') { $r[$Matches[1]] = ($Matches[2] -eq '1') } }
  $r
}

$PythonProbe = @'
import socket, sys
ip = sys.argv[1]
site = sys.argv[2]
def reach(host, port):
    try:
        c = socket.create_connection((host, port), 5)
        c.close()
        return 1
    except Exception:
        return 0
l = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
l.bind(("127.0.0.1", 0))
l.listen(1)
print("loop=%d" % reach("127.0.0.1", l.getsockname()[1]))
l.close()
print("out=%d" % reach(ip, 443))
print("site=%d" % reach(site, 443))
'@

$NodeProbe = @'
const net = require("net");
const ip = process.argv[2];
const site = process.argv[3];
function reach(host, port) {
  return new Promise((done) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); done(0); }, 5000);
    s.on("connect", () => { clearTimeout(t); s.destroy(); done(1); });
    s.on("error", () => { clearTimeout(t); done(0); });
  });
}
const srv = net.createServer((c) => c.destroy());
srv.listen(0, "127.0.0.1", async () => {
  console.log("loop=" + (await reach("127.0.0.1", srv.address().port)));
  srv.close();
  console.log("out=" + (await reach(ip, 443)));
  console.log("site=" + (await reach(site, 443)));
});
'@

try {
  $cfg = [IO.File]::ReadAllText($In) | ConvertFrom-Json
} catch {
  $why = $_.Exception.Message
  Add-Result "reads its input $In" $true { throw $why } -Strict
  Save-Results
  exit 0
}
function Get-List($Value) { @($Value | Where-Object { $_ }) }

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
Add-Result 'runs as' $null { $id.Name }
Add-Result 'has no admin rights' $true { -not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

# What the worker reads to tell the person's own GPU work apart from other programs.
Add-Result 'reads the GPU memory counters of other programs (process count)' $true {
  $lines = & typeperf '\GPU Process Memory(*)\Dedicated Usage' -sc 1 2>$null
  $head = $lines | Where-Object { $_ -like '"(PDH-CSV*' } | Select-Object -First 1
  $n = 0
  if ($head) { $n = ([regex]::Matches($head, 'pid_(\d+)_') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique).Count }
  if ($n -lt 3) { $false } else { $n }
}
Add-Result 'reads the table of listening ports with process ids (count)' $true {
  $n = @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -gt 4 }).Count
  if ($n -lt 1) { $false } else { $n }
}
Add-Result 'sees the names of other processes (count)' $true {
  $n = @(Get-Process | Where-Object { $_.ProcessName }).Count
  if ($n -lt 10) { $false } else { $n }
}

# Its own folders: it writes its data folders, never its code or the root.
foreach ($d in (Get-List $cfg.canWrite)) { Add-Result "can write $d" $true { Test-CanCreate $d } }
foreach ($d in (Get-List $cfg.cannotWrite)) {
  if (Test-Path -LiteralPath $d) { Add-Result "cannot write $d (code)" $false { Test-CanCreate $d } }
}

# ComfyUI, its Python and the model folders: read, never write.
foreach ($d in (Get-List $cfg.readDirs)) {
  Add-Result "can list $d" $true { Test-CanList $d }
  Add-Result "cannot write $d" $false { Test-CanCreate $d }
}

# ffmpeg: runs, and its folder is not writable.
if ($cfg.ffmpeg) {
  $ff = $cfg.ffmpeg
  Add-Result "can run $ff" $true { & $ff -hide_banner -version 2>$null | Out-Null; $LASTEXITCODE -eq 0 }
  Add-Result "cannot write $(Split-Path $ff -Parent)" $false { Test-CanCreate (Split-Path $ff -Parent) }
}

# Closed places: listing them and writing to them must fail.
foreach ($d in (Get-List $cfg.closed)) {
  if (-not (Test-Path -LiteralPath $d -ErrorAction SilentlyContinue)) { continue }
  Add-Result "cannot list $d" $false { Test-CanList $d }
  Add-Result "cannot write $d" $false { Test-CanCreate $d }
}
# Places that the worker may read but must not change.
foreach ($d in (Get-List $cfg.noWrite)) {
  if (-not (Test-Path -LiteralPath $d -ErrorAction SilentlyContinue)) { continue }
  Add-Result "cannot write $d" $false { Test-CanCreate $d }
}

# Network. The probe host must be out of reach for this user and for the worker's python.exe and node.exe. This PC
# must be in reach, and node.exe must reach the site. The lookup runs here, so a failed lookup never passes as
# "blocked".
$probe = $cfg.probeHost
$siteHost = $cfg.siteHost
$ip = $null
Add-Result "finds the address of $probe" $true {
  $all = @([Net.Dns]::GetHostAddresses($probe))
  $v4 = @($all | Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork })
  $pick = $null
  if ($v4.Count) { $pick = $v4[0] } elseif ($all.Count) { $pick = $all[0] }
  if (-not $pick) { throw "No address for $probe." }
  $script:ip = $pick.ToString()
  $script:ip
} -Strict
Add-Result 'reaches this PC (127.0.0.1)' $true {
  $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $l.Start()
  try { Test-Tcp '127.0.0.1' ($l.LocalEndpoint.Port) } finally { $l.Stop() }
} -Strict
if ($ip) {
  Add-Result "cannot reach $probe ($ip) on port 443" $false { Test-Tcp $ip 443 } -Strict
}

$probes = @(
  @{ Name = "the worker's python.exe"; Exe = $cfg.python; Ext = '.py'; Code = $PythonProbe; Pre = @('-I'); Site = $false },
  @{ Name = "the worker's node.exe"; Exe = $cfg.nodeExe; Ext = '.cjs'; Code = $NodeProbe; Pre = @(); Site = $true }
)
foreach ($p in $probes) {
  if (-not $p.Exe) { continue }
  if (-not (Test-Path -LiteralPath $p.Exe)) {
    Add-Result "$($p.Name) is there ($($p.Exe))" $true { $false } -Strict
    continue
  }
  if (-not $ip) {
    Add-Result "$($p.Name): network check" $true { throw "No address for $probe, so the check cannot tell whether the internet is blocked." } -Strict
    continue
  }
  $file = Join-Path $cfg.tempDir ('limited-check-' + [guid]::NewGuid().ToString('N') + $p.Ext)
  $r = $null
  try {
    [IO.File]::WriteAllText($file, $p.Code, (New-Object Text.UTF8Encoding($false)))
    $r = Invoke-NetProbe $p.Exe (@($p.Pre) + @($file, $ip, $siteHost))
  } catch {
    $r = @{ loop = $null; out = $null; site = $null; text = $_.Exception.Message }
  } finally {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
  $res = $r
  Add-Result "$($p.Name) reaches this PC (127.0.0.1)" $true { if ($null -eq $res.loop) { throw "No answer: $($res.text)" }; $res.loop } -Strict
  Add-Result "$($p.Name) cannot reach $probe ($ip) on port 443" $false { if ($null -eq $res.out) { throw "No answer: $($res.text)" }; $res.out } -Strict
  if ($p.Site) {
    Add-Result "$($p.Name) reaches $siteHost on port 443" $true { if ($null -eq $res.site) { throw "No answer: $($res.text)" }; $res.site } -Strict
  } else {
    Add-Result "$($p.Name) cannot reach $siteHost on port 443" $false { if ($null -eq $res.site) { throw "No answer: $($res.text)" }; $res.site } -Strict
  }
}

Save-Results

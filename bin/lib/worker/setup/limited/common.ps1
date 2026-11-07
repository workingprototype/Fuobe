# Shared helpers for the limited-user worker setup (Install-, Remove-, Stop-LimitedWorker.ps1 and the tests).
# Nothing in this file changes the PC by itself. The scripts call these helpers inside $PSCmdlet.ShouldProcess, so
# -WhatIf shows each change and makes none. Windows PowerShell 5.1 or later. No function here prints a secret.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Load the CIM commands now with -WhatIf off: loading them sets aliases, and under -WhatIf PowerShell only prints those.
$limitedWhatIf = $WhatIfPreference
$WhatIfPreference = $false
Import-Module CimCmdlets
$WhatIfPreference = $limitedWhatIf
Remove-Variable limitedWhatIf -WhatIf:$false

# Well-known SIDs (the same on every Windows PC, in every language).
$SidSystem = 'S-1-5-18'
$SidAdmins = 'S-1-5-32-544'
$SidUsers = 'S-1-5-32-545'
$SidPerfMonUsers = 'S-1-5-32-558'
# Groups that are (or may be) in the worker user's token. A folder that lets one of them write lets the worker write.
# Everyone, Authenticated Users, Users, INTERACTIVE, BATCH, Local account, LOCAL, CONSOLE LOGON, This Organization,
# NTLM Authentication, Performance Monitor Users.
$BroadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-4', 'S-1-5-3', 'S-1-5-113', 'S-1-2-0', 'S-1-2-1', 'S-1-5-15',
  'S-1-5-64-10', 'S-1-5-32-558')

# Firewall rule groups and the name prefix of the rules. Remove-LimitedWorker.ps1 removes these groups.
$FirewallGroup = 'Fuobe worker (limited)'
$FirewallUserGroup = 'Fuobe worker (limited, whole user)'
$FirewallRulePrefix = 'FuobeLimitedWorker-'
# The check task that runs once as the worker user, beside the worker task.
$CheckTaskName = 'Worker check'
# The task that a normal (non-limited) install makes: it runs the worker as the signed-in person.
$SignInTaskName = 'Fuobe worker'
$ShortcutNames = @('Pause Fuobe worker', 'Resume Fuobe worker')

# icacls rights lists. "Deny all" keeps read-attributes, read-permissions and synchronize, so a path can still be
# looked at (Node and Python look at each folder of a path), but no folder can be listed and no file read or changed.
$DenyAll = '(RD,WD,AD,REA,WEA,X,DC,WA,DE,WDAC,WO)'
$DenyWrite = '(WD,AD,WEA,DC,WA,DE,WDAC,WO)'
# This folder only (for the top of the system drive and ProgramData): no new files (0x2) and no new folders (0x4).
$DenyCreateMask = 0x2 -bor 0x4

# The user rights that the install sets for the worker user (the undo removes the same list).
$WorkerRights = [ordered]@{
  SeBatchLogonRight                 = 'Log on as a batch job (the scheduled task needs it)'
  SeDenyInteractiveLogonRight       = 'Deny sign-in at this PC'
  SeDenyRemoteInteractiveLogonRight = 'Deny sign-in over Remote Desktop'
  SeDenyNetworkLogonRight           = 'Deny access to this PC from the network'
}

function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Note([string]$Text) { Write-Host "   $Text" }

function Test-IsAdmin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# A real run needs an elevated PowerShell. -WhatIf goes on without one and changes nothing.
function Assert-Admin([bool]$WhatIfRun) {
  if (Test-IsAdmin) { return }
  if ($WhatIfRun) {
    Write-Warning 'This PowerShell is not elevated. -WhatIf goes on and changes nothing. The real run needs an elevated PowerShell.'
    return
  }
  throw 'Run this script from an elevated PowerShell (Run as administrator).'
}

function Assert-64BitPowerShell {
  if (-not [Environment]::Is64BitProcess) { throw 'Run this script in the 64-bit PowerShell, not the (x86) one.' }
}

# Runs a program and stops on an exit code that is not in $OkCodes. Returns its output lines.
function Invoke-Native {
  param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$ArgumentList = @(), [int[]]$OkCodes = @(0))
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $FilePath @ArgumentList 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  if ($OkCodes -notcontains $code) {
    throw "$FilePath $($ArgumentList -join ' ') ended with exit code $code. $(($out | Select-Object -Last 5) -join ' ')"
  }
  $out
}

function Invoke-Icacls([string[]]$ArgumentList) { Invoke-Native -FilePath "$env:SystemRoot\System32\icacls.exe" -ArgumentList $ArgumentList | Out-Null }

# ----- Accounts -----

function Get-AccountSid([string]$Name) {
  try { (New-Object Security.Principal.NTAccount($Name)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { $null }
}

function Get-WorkerSid([string]$WorkerUser) { Get-AccountSid "$env:COMPUTERNAME\$WorkerUser" }

# The person's own account. Default: the account that runs the script.
function Resolve-OwnerAccount([string]$OwnerUser, [string]$WorkerSid) {
  if (-not $OwnerUser) { $OwnerUser = "$env:USERDOMAIN\$env:USERNAME" }
  $sid = Get-AccountSid $OwnerUser
  if (-not $sid) { throw "No account is named $OwnerUser. Give the person's account with -OwnerUser." }
  if ($WorkerSid -and $sid -eq $WorkerSid) { throw 'The owner account and the worker user are the same account. Give the person''s account with -OwnerUser.' }
  if ($sid -notmatch '^S-1-5-21-' -and $sid -notmatch '^S-1-12-1-') { throw "$OwnerUser is not a person's account. Give the person's account with -OwnerUser." }
  [pscustomobject]@{ Name = $OwnerUser; Sid = $sid }
}

# The profile folder of an account (by SID), or $null.
function Get-ProfilePath([string]$Sid) {
  $p = Get-CimInstance Win32_UserProfile -Filter "SID='$Sid'" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { $p.LocalPath } else { $null }
}

# The desktop folder of an account. For the account that runs the script, Windows says where it is. For another
# account: its shell folder setting when its registry is loaded, else <profile>\Desktop.
function Get-DesktopPath([string]$Sid) {
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($Sid -eq $me) { return [Environment]::GetFolderPath('Desktop') }
  $profilePath = Get-ProfilePath $Sid
  if (-not $profilePath) { return $null }
  $key = "Registry::HKEY_USERS\$Sid\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
  if (Test-Path -LiteralPath $key) {
    $k = Get-Item -LiteralPath $key
    $raw = $k.GetValue('Desktop', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($raw) {
      $v = ([string]$raw) -ireplace '%USERPROFILE%', $profilePath
      if ($v -notmatch '%') { return $v }
    }
  }
  Join-Path $profilePath 'Desktop'
}

# Is the account (by SID) a member of the local group (by SID)? ADSI also works when the group holds a SID that
# Windows cannot name (Get-LocalGroupMember stops on such a group).
function Test-LocalGroupMember([string]$GroupSid, [string]$MemberSid) {
  $name = (Get-LocalGroup -SID $GroupSid).Name
  $group = [ADSI]"WinNT://$env:COMPUTERNAME/$name,group"
  foreach ($m in @($group.Invoke('Members'))) {
    $bytes = $m.GetType().InvokeMember('objectSid', 'GetProperty', $null, $m, $null)
    if ((New-Object Security.Principal.SecurityIdentifier($bytes, 0)).Value -eq $MemberSid) { return $true }
  }
  $false
}

# ----- Paths -----

# A full path without a trailing backslash (a drive root keeps its backslash).
function Get-FullPath([string]$Path) {
  $f = [IO.Path]::GetFullPath($Path)
  if ($f.Length -gt 3) { $f = $f.TrimEnd('\') }
  $f
}

function Test-DriveRoot([string]$Path) {
  $f = [IO.Path]::GetFullPath($Path)
  [IO.Path]::GetPathRoot($f).TrimEnd('\') -ieq $f.TrimEnd('\')
}

function Test-PathInside([string]$Path, [string]$Folder) {
  $p = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
  $f = [IO.Path]::GetFullPath($Folder).TrimEnd('\') + '\'
  $p.StartsWith($f, [StringComparison]::OrdinalIgnoreCase)
}

# The worker's layout under $Root. $VersionDir is the current versions\<id> folder.
function Get-WorkerPaths([string]$Root, [string]$VersionDir = '') {
  $r = Get-FullPath $Root
  $p = [ordered]@{
    Root       = $r
    Versions   = Join-Path $r 'versions'
    Bin        = Join-Path $r 'bin'
    WorkerHome = Join-Path $r 'home'
    Work       = Join-Path $r 'work'
    Temp       = Join-Path $r 'temp'
    Cache      = Join-Path $r 'temp\cache'
    WorkerCmd  = Join-Path $r 'bin\worker.cmd'
    RunCmd     = Join-Path $r 'bin\run-worker.cmd'
    CheckPs1   = Join-Path $r 'bin\check-as-worker.ps1'
    CheckIn    = Join-Path $r 'bin\check-input.json'
    CheckOut   = Join-Path $r 'home\check-as-worker.json'
    Log        = Join-Path $r 'home\worker.log'
    StateFile  = Join-Path $r 'limited-setup-state.json'
    VersionDir = $null
    NodeExe    = $null
    FuobeMjs   = $null
  }
  if ($VersionDir) {
    $v = Get-FullPath $VersionDir
    $p.VersionDir = $v
    $p.NodeExe = Join-Path $v 'node\node.exe'
    $p.FuobeMjs = Join-Path $v 'app\bin\fuobe.mjs'
  }
  [pscustomobject]$p
}

# Names of the folders right below the root that the worker user may write in.
$DataFolderNames = @('home', 'work', 'temp')

# Writes text as UTF-8 without a byte-order mark (Node's JSON.parse refuses one), through a temporary file.
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $tmp = "$Path.tmp"
  [IO.File]::WriteAllText($tmp, $Text, (New-Object Text.UTF8Encoding($false)))
  # [NullString]::Value: a real null (PowerShell passes $null to a string argument as '').
  if ([IO.File]::Exists($Path)) { [IO.File]::Replace($tmp, $Path, [NullString]::Value) } else { [IO.File]::Move($tmp, $Path) }
}

# ----- The ComfyUI Python -----

# The Python that the worker starts for ComfyUI, in the worker's own order: python.exe in -PythonDir when given, else
# the portable one beside ComfyUI, its venv, then .venv. A venv's python.exe starts the real Python as a second
# process, so that one is named too. Returns { Python; Files (for the firewall); ReadDirs (for read rights); IsVenv }.
function Find-WorkerPython([string]$ComfyDir, [string]$PythonDir = '') {
  if ($PythonDir) {
    $tries = @((Join-Path $PythonDir 'python.exe'))
  } else {
    $tries = @(
      (Join-Path $ComfyDir '..\python_embeded\python.exe'),
      (Join-Path $ComfyDir 'venv\Scripts\python.exe'),
      (Join-Path $ComfyDir '.venv\Scripts\python.exe')
    )
  }
  foreach ($t in $tries) {
    if (-not (Test-Path -LiteralPath $t -PathType Leaf)) { continue }
    $exe = Get-FullPath (Resolve-Path -LiteralPath $t).ProviderPath
    $dir = Split-Path $exe -Parent
    $files = New-Object System.Collections.Generic.List[string]
    $readDirs = New-Object System.Collections.Generic.List[string]
    $files.Add($exe)
    $w = Join-Path $dir 'pythonw.exe'
    if (Test-Path -LiteralPath $w) { $files.Add($w) }
    $venvRoot = Split-Path $dir -Parent
    $cfg = Join-Path $venvRoot 'pyvenv.cfg'
    $isVenv = Test-Path -LiteralPath $cfg
    if ($isVenv) {
      $readDirs.Add($venvRoot)
      $homeLine = Get-Content -LiteralPath $cfg | Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1
      if (-not $homeLine) { throw "$cfg names no home folder, so the real Python of the venv is unknown." }
      $baseDir = ($homeLine -split '=', 2)[1].Trim()
      $base = Join-Path $baseDir 'python.exe'
      if (-not (Test-Path -LiteralPath $base)) { throw "The venv's real Python $base is not there." }
      $files.Add((Get-FullPath (Resolve-Path -LiteralPath $base).ProviderPath))
      $readDirs.Add((Get-FullPath $baseDir))
    } else {
      $readDirs.Add($dir)
    }
    return [pscustomobject]@{ Python = $exe; Files = @($files | Select-Object -Unique); ReadDirs = @($readDirs | Select-Object -Unique); IsVenv = $isVenv }
  }
  $null
}

# ----- Read rights outside the root -----

# Folders that every standard user reads already. The install adds no entry to them.
function Get-SystemReadableDirs {
  @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
}

# Which of $Dirs get an explicit read entry for the worker user. Returns { Grant; Skip; Problems }:
# - Problems: a whole drive, or a folder inside home, work or temp (the worker user can write there).
# - Skip: inside the root (the worker reads it already), inside a system folder, or inside another folder of the list.
function Get-ReadPlan([string[]]$Dirs, $Paths, [string[]]$SystemDirs = @()) {
  $grant = New-Object System.Collections.Generic.List[string]
  $skip = New-Object System.Collections.Generic.List[object]
  $problems = New-Object System.Collections.Generic.List[string]
  $list = New-Object System.Collections.Generic.List[string]
  foreach ($d in @($Dirs | Where-Object { $_ })) {
    $full = Get-FullPath $d
    if (-not @($list | Where-Object { $_ -ieq $full }).Count) { $list.Add($full) }
  }
  foreach ($full in $list) {
    if (Test-DriveRoot $full) { $problems.Add("$full is a whole drive. Give the folder itself."); continue }
    $bad = $false
    foreach ($w in @($Paths.WorkerHome, $Paths.Work, $Paths.Temp)) {
      if (Test-PathInside $full $w) { $problems.Add("$full is inside $w, where the worker user can write. Programs and models must be elsewhere."); $bad = $true }
    }
    if ($bad) { continue }
    if (Test-PathInside $full $Paths.Root) { $skip.Add([pscustomobject]@{ Path = $full; Why = 'inside the worker root, which the worker reads' }); continue }
    $sysHit = @($SystemDirs | Where-Object { $_ -and (Test-PathInside $full $_) })
    if ($sysHit.Count) { $skip.Add([pscustomobject]@{ Path = $full; Why = "inside $($sysHit[0]), which every user reads" }); continue }
    $outer = @($list | Where-Object { $_ -ine $full -and (Test-PathInside $full $_) -and -not (Test-DriveRoot $_) })
    if ($outer.Count) { $skip.Add([pscustomobject]@{ Path = $full; Why = "inside $($outer[0]), which gets the entry" }); continue }
    $grant.Add($full)
  }
  [pscustomobject]@{ Grant = $grant.ToArray(); Skip = $skip.ToArray(); Problems = $problems.ToArray() }
}

# The deny mask for a closed place: "deny any change" when it holds, or sits inside, a folder that the worker must
# read; else "deny all".
function Get-CloseMask([string]$Path, [string[]]$KeepRead) {
  foreach ($k in @($KeepRead | Where-Object { $_ })) {
    if ((Test-PathInside $Path $k) -or (Test-PathInside $k $Path)) { return $DenyWrite }
  }
  $DenyAll
}

# ----- Command files -----

# A path for a .cmd file: plain printable ASCII (the file is written as ASCII), no quote, and % doubled.
function ConvertTo-CmdText([string]$Text) {
  if ($Text -match '["\r\n]') { throw "A path for a .cmd file cannot hold a quote or a line break: $Text" }
  if ($Text -match '[^\x20-\x7E]') { throw "Use a folder path with plain ASCII characters only (a .cmd file cannot hold $Text safely)." }
  $Text.Replace('%', '%%')
}

function Join-CmdLines([string[]]$Lines) { ($Lines -join "`r`n") + "`r`n" }

# bin\worker.cmd: runs `fuobe worker <args>` with the current version, for the person (setup, pause, resume, status).
function New-WorkerCmdText($Paths) {
  $homeDir = ConvertTo-CmdText $Paths.WorkerHome
  $node = ConvertTo-CmdText $Paths.NodeExe
  $mjs = ConvertTo-CmdText $Paths.FuobeMjs
  Join-CmdLines @(
    '@echo off'
    'rem The Fuobe worker''s commands: setup, pause, resume, status. Example: worker.cmd pause --for 2h'
    'rem Written by Install-LimitedWorker.ps1. Run it again to write this file again.'
    'setlocal'
    "set ""FUOBE_WORKER_HOME=$homeDir"""
    """$node"" ""$mjs"" worker %*"
    'exit /b %ERRORLEVEL%'
  )
}

# bin\run-worker.cmd: the start file of the scheduled task. It sets the worker's folders, empties temp (it keeps
# temp\cache), runs `worker run` with its output in home\worker.log, and starts it again after a stop: after 60 s,
# 600 s after exit code 3 (the site refused the token), 5 s after exit code 75 (new code is installed). Exit code 0
# ends it. worker.log moves to worker.log.1 at a start when it is over 20 MB.
function New-RunWorkerCmdText($Paths, [string]$TaskLabel) {
  $homeDir = ConvertTo-CmdText $Paths.WorkerHome
  $temp = ConvertTo-CmdText $Paths.Temp
  $cache = ConvertTo-CmdText $Paths.Cache
  $log = ConvertTo-CmdText $Paths.Log
  $node = ConvertTo-CmdText $Paths.NodeExe
  $mjs = ConvertTo-CmdText $Paths.FuobeMjs
  $label = ConvertTo-CmdText $TaskLabel
  Join-CmdLines @(
    '@echo off'
    "rem Starts the Fuobe worker. The scheduled task $label runs this file as the worker user."
    'rem After a stop it starts the worker again: after 60 s, 600 s after exit code 3, 5 s after exit code 75.'
    'rem Exit code 0 (a stop by hand) ends it. Written by Install-LimitedWorker.ps1.'
    'setlocal'
    "set ""FUOBE_WORKER_HOME=$homeDir"""
    "set ""TEMP=$temp"""
    "set ""TMP=$temp"""
    "set ""XDG_CACHE_HOME=$cache"""
    "set ""CUDA_CACHE_PATH=$cache\nvidia"""
    "set ""LOG=$log"""
    ':start'
    'rem Empty the temp folder, but keep its cache folder.'
    "for /d %%D in (""$temp\*"") do if /i not ""%%~nxD""==""cache"" rd /s /q ""%%D"" 2>nul"
    "del /f /q ""$temp\*"" 2>nul"
    'if exist "%LOG%" for %%F in ("%LOG%") do if %%~zF GTR 20000000 move /y "%LOG%" "%LOG%.1" >nul'
    '>>"%LOG%" echo [%DATE% %TIME%] The worker starts.'
    """$node"" ""$mjs"" worker run >>""%LOG%"" 2>&1"
    'set "CODE=%ERRORLEVEL%"'
    'if "%CODE%"=="0" exit /b 0'
    'set "WAIT=60"'
    'if "%CODE%"=="3" set "WAIT=600"'
    'if "%CODE%"=="75" set "WAIT=5"'
    '>>"%LOG%" echo [%DATE% %TIME%] The worker stopped with exit code %CODE%. It starts again in %WAIT% seconds.'
    'set /a PINGS=WAIT+1'
    'ping -n %PINGS% 127.0.0.1 >nul'
    'goto start'
  )
}

function Write-AsciiFile([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, [Text.Encoding]::ASCII)
}

# ----- Passwords -----

# A random password: 40 characters, each of the four kinds at least once, from the system's secure random source.
# The scripts never print it and never write it to a file.
function New-WorkerPassword([int]$Length = 40) {
  $sets = @('ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#%+-.:=?@_~')
  $all = -join $sets
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $buf = New-Object byte[] 4
    # A uniform random whole number from 0 to $count - 1 (rejection sampling).
    $index = {
      param([int]$count)
      $limit = [uint32]([Math]::Floor(4294967296 / $count) * $count - 1)
      do { $rng.GetBytes($buf); $v = [BitConverter]::ToUInt32($buf, 0) } while ($v -gt $limit)
      [int]($v % [uint32]$count)
    }
    $chars = New-Object System.Collections.Generic.List[char]
    foreach ($s in $sets) { $chars.Add($s[(& $index $s.Length)]) }
    while ($chars.Count -lt $Length) { $chars.Add($all[(& $index $all.Length)]) }
    for ($i = $chars.Count - 1; $i -gt 0; $i--) {
      $j = & $index ($i + 1)
      $t = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $t
    }
    -join $chars
  } finally {
    $rng.Dispose()
  }
}

# ----- IP ranges for the firewall -----

# Cloudflare's published edge ranges, from https://www.cloudflare.com/ips/ (ips-v4 and ips-v6). Used when every
# address of the site is inside them. -SiteAddresses replaces them.
$CloudflareV4 = @('173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22')
$CloudflareV6 = @('2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32')
$LoopbackRanges = @('127.0.0.0/8', '::1/128')

function ConvertTo-IpNumber([Net.IPAddress]$Ip) {
  $b = $Ip.GetAddressBytes()
  [array]::Reverse($b)
  New-Object Numerics.BigInteger -ArgumentList (, [byte[]]($b + [byte]0))
}

function ConvertFrom-IpNumber([Numerics.BigInteger]$N, [int]$Bytes) {
  $raw = $N.ToByteArray()
  $out = New-Object byte[] $Bytes
  for ($i = 0; $i -lt [Math]::Min($Bytes, $raw.Length); $i++) { $out[$i] = $raw[$i] }
  [array]::Reverse($out)
  (New-Object Net.IPAddress -ArgumentList (, $out)).ToString()
}

# "10.0.0.0/8" -> { Family 4|6; Start; End } as big numbers. A plain address counts as one address.
function Get-CidrBounds([string]$Cidr) {
  $parts = $Cidr.Trim().Split('/')
  $ip = [Net.IPAddress]::Parse($parts[0])
  $v6 = $ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6
  $bits = 32
  if ($v6) { $bits = 128 }
  $len = $bits
  if ($parts.Count -gt 1) { $len = [int]$parts[1] }
  if ($len -lt 0 -or $len -gt $bits) { throw "$Cidr is not an address range." }
  $n = ConvertTo-IpNumber $ip
  $size = [Numerics.BigInteger]::Pow(2, $bits - $len)
  $start = $n - ($n % $size)
  $family = 4
  if ($v6) { $family = 6 }
  [pscustomobject]@{ Family = $family; Start = $start; End = $start + $size - 1 }
}

# Every address of one family that is NOT in $Keep, as firewall range strings ("a-b" or one address). The IPv6
# unspecified address "::" is left out: nothing can connect to it.
function Get-ComplementRanges([string[]]$Keep, [int]$Family) {
  $bits = 32
  if ($Family -eq 6) { $bits = 128 }
  $bytes = $bits / 8
  $max = [Numerics.BigInteger]::Pow(2, $bits) - 1
  $ranges = @($Keep | ForEach-Object { Get-CidrBounds $_ } | Where-Object { $_.Family -eq $Family } | Sort-Object -Property Start)
  $gaps = New-Object System.Collections.Generic.List[object]
  $next = [Numerics.BigInteger]::Zero
  foreach ($r in $ranges) {
    if ($r.Start -gt $next) { $gaps.Add(@($next, ($r.Start - 1))) }
    if (($r.End + 1) -gt $next) { $next = $r.End + 1 }
  }
  if ($next -le $max) { $gaps.Add(@($next, $max)) }
  foreach ($g in $gaps) {
    $a = $g[0]; $z = $g[1]
    if ($Family -eq 6 -and $a -eq 0) {
      if ($z -eq 0) { continue }
      $a = [Numerics.BigInteger]::One
    }
    if ($a -eq $z) { ConvertFrom-IpNumber $a $bytes } else { "$(ConvertFrom-IpNumber $a $bytes)-$(ConvertFrom-IpNumber $z $bytes)" }
  }
}

function Test-IpInRanges([string]$Ip, [string[]]$Ranges) {
  $addr = [Net.IPAddress]::Parse($Ip)
  $n = ConvertTo-IpNumber $addr
  $fam = 4
  if ($addr.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) { $fam = 6 }
  foreach ($r in $Ranges) {
    $b = Get-CidrBounds $r
    if ($b.Family -eq $fam -and $n -ge $b.Start -and $n -le $b.End) { return $true }
  }
  $false
}

# The host of the site address. It must be https on port 443 (the firewall rules allow that port only).
function Get-SiteHost([string]$Site) {
  $u = $null
  if (-not [Uri]::TryCreate($Site, [UriKind]::Absolute, [ref]$u)) { throw "-Site must be a full https address, such as https://example.com ($Site)." }
  if ($u.Scheme -ne 'https') { throw "-Site must start with https:// ($Site)." }
  if (-not $u.DnsSafeHost) { throw "-Site names no host ($Site)." }
  if ($u.Port -ne 443) { throw "The firewall rules allow the site on port 443 only, and $Site uses port $($u.Port)." }
  $u.DnsSafeHost
}

# The addresses of a host now (one lookup), or the host itself when it is an address.
function Resolve-SiteAddresses([string]$HostName) {
  $ip = $null
  if ([Net.IPAddress]::TryParse($HostName, [ref]$ip)) { return @($ip.ToString()) }
  @([Net.Dns]::GetHostAddresses($HostName) | ForEach-Object { $_.ToString() } | Where-Object { $_ -notmatch '%' } | Select-Object -Unique)
}

# The ranges the worker may reach on TCP 443. $Given (-SiteAddresses) wins, and every resolved address must be inside
# it. Else Cloudflare's ranges when every resolved address is inside them, else the resolved addresses themselves.
# Returns { Ranges; Source = given | cloudflare | resolved }.
function Get-SiteRanges([string[]]$Resolved, [string[]]$Given) {
  $Resolved = @($Resolved | Where-Object { $_ })
  $Given = @($Given | Where-Object { $_ })
  if ($Given.Count) {
    foreach ($r in $Given) { Get-CidrBounds $r | Out-Null }
    foreach ($ip in $Resolved) { if (-not (Test-IpInRanges $ip $Given)) { throw "The site is at $ip, which is outside -SiteAddresses. The worker could not reach it." } }
    return [pscustomobject]@{ Ranges = $Given; Source = 'given' }
  }
  if (-not $Resolved.Count) { throw 'The site has no address. Check the network, or pass -SiteAddresses.' }
  $cf = @($CloudflareV4 + $CloudflareV6)
  $allCf = $true
  foreach ($ip in $Resolved) { if (-not (Test-IpInRanges $ip $cf)) { $allCf = $false } }
  if ($allCf) { return [pscustomobject]@{ Ranges = $cf; Source = 'cloudflare' } }
  $own = foreach ($ip in $Resolved) {
    if ([Net.IPAddress]::Parse($ip).AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) { "$ip/128" } else { "$ip/32" }
  }
  [pscustomobject]@{ Ranges = @($own); Source = 'resolved' }
}

# ----- User rights (Local Security Policy), through the LSA API -----

function Initialize-Lsa {
  if ('FuobeLimitedLsa' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class FuobeLimitedLsa
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }

    [DllImport("advapi32.dll")] private static extern uint LsaOpenPolicy(IntPtr systemName, ref LSA_OBJECT_ATTRIBUTES attributes, uint access, out IntPtr handle);
    [DllImport("advapi32.dll")] private static extern uint LsaAddAccountRights(IntPtr handle, byte[] sid, LSA_UNICODE_STRING[] rights, uint count);
    [DllImport("advapi32.dll")] private static extern uint LsaRemoveAccountRights(IntPtr handle, byte[] sid, [MarshalAs(UnmanagedType.U1)] bool allRights, LSA_UNICODE_STRING[] rights, uint count);
    [DllImport("advapi32.dll")] private static extern uint LsaEnumerateAccountRights(IntPtr handle, byte[] sid, out IntPtr rights, out uint count);
    [DllImport("advapi32.dll")] private static extern uint LsaFreeMemory(IntPtr buffer);
    [DllImport("advapi32.dll")] private static extern uint LsaClose(IntPtr handle);
    [DllImport("advapi32.dll")] private static extern int LsaNtStatusToWinError(uint status);

    // POLICY_VIEW_LOCAL_INFORMATION | POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES
    private const uint Access = 0x00000001 | 0x00000010 | 0x00000800;
    private const uint NotFound = 0xC0000034;

    private static IntPtr Open()
    {
        var a = new LSA_OBJECT_ATTRIBUTES();
        a.Length = Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES));
        IntPtr h;
        uint s = LsaOpenPolicy(IntPtr.Zero, ref a, Access, out h);
        if (s != 0) throw new Win32Exception(LsaNtStatusToWinError(s));
        return h;
    }

    private static byte[] Sid(string sid)
    {
        var s = new SecurityIdentifier(sid);
        var b = new byte[s.BinaryLength];
        s.GetBinaryForm(b, 0);
        return b;
    }

    public static string[] Get(string sid)
    {
        IntPtr h = Open();
        try
        {
            IntPtr p; uint n;
            uint s = LsaEnumerateAccountRights(h, Sid(sid), out p, out n);
            if (s == NotFound) return new string[0];
            if (s != 0) throw new Win32Exception(LsaNtStatusToWinError(s));
            try
            {
                var list = new List<string>();
                int size = Marshal.SizeOf(typeof(LSA_UNICODE_STRING));
                for (int i = 0; i < n; i++)
                {
                    var u = (LSA_UNICODE_STRING)Marshal.PtrToStructure(new IntPtr(p.ToInt64() + i * size), typeof(LSA_UNICODE_STRING));
                    list.Add(Marshal.PtrToStringUni(u.Buffer, u.Length / 2));
                }
                return list.ToArray();
            }
            finally { LsaFreeMemory(p); }
        }
        finally { LsaClose(h); }
    }

    private static void Change(string sid, string right, bool add)
    {
        IntPtr h = Open();
        var u = new LSA_UNICODE_STRING();
        u.Buffer = Marshal.StringToHGlobalUni(right);
        u.Length = (ushort)(right.Length * 2);
        u.MaximumLength = (ushort)(u.Length + 2);
        try
        {
            uint s = add ? LsaAddAccountRights(h, Sid(sid), new[] { u }, 1) : LsaRemoveAccountRights(h, Sid(sid), false, new[] { u }, 1);
            if (s != 0 && !(s == NotFound && !add)) throw new Win32Exception(LsaNtStatusToWinError(s));
        }
        finally { Marshal.FreeHGlobal(u.Buffer); LsaClose(h); }
    }

    public static void Add(string sid, string right) { Change(sid, right, true); }
    public static void Remove(string sid, string right) { Change(sid, right, false); }
}
'@
}

# ----- Files, rights and processes through the Windows API -----
# - Scan: walks a folder tree and never follows a link. It lists the links (junctions, symbolic links) and the files
#   that have a second name somewhere else (hard links). icacls /T follows junctions, so the scripts run it only on
#   trees that this scan found clean.
# - DeleteTree: deletes a tree without changing any rights and without following a link (a link is deleted, never the
#   folder it points to). In an elevated PowerShell it uses the backup and restore rights.
# - AddThisFolderDeny / RemoveThisFolderEntries: change one folder's rights only, without a walk below.
# - ProcessSid: the user of a running process, read from its token.

function Initialize-LimitedNative {
  if ('FuobeLimitedNative' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public static class FuobeLimitedNative
{
    const uint FILE_LIST_DIRECTORY = 0x1, FILE_READ_ATTRIBUTES = 0x80, FILE_WRITE_ATTRIBUTES = 0x100, DELETE = 0x10000, SYNCHRONIZE = 0x100000;
    const uint SHARE_ALL = 7, OPEN_EXISTING = 3, FLAG_BACKUP = 0x02000000, FLAG_OPEN_REPARSE = 0x00200000;
    const uint ATTR_READONLY = 0x1, ATTR_DIR = 0x10, ATTR_REPARSE = 0x400, ATTR_NORMAL = 0x80, ATTR_SETTABLE = 0x31A7;
    const uint INVALID_ATTR = 0xFFFFFFFF;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandleEx(SafeFileHandle h, int cls, IntPtr buf, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetFileInformationByHandle(SafeFileHandle h, int cls, IntPtr buf, int size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFileAttributesW(string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, int len, out int needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool LookupPrivilegeValueW(string system, string name, out long luid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES state, int len, IntPtr prev, IntPtr retLen);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetFileSecurityW(string name, int info, byte[] sd, int len, out int needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetFileSecurityW(string name, int info, byte[] sd);

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct TOKEN_PRIVILEGES { public int Count; public long Luid; public int Attributes; }

    struct Entry { public string Name; public uint Attributes; }

    static string Long(string path)
    {
        if (path.StartsWith(@"\\?\")) return path;
        if (path.StartsWith(@"\\")) return @"\\?\UNC\" + path.Substring(2);
        return @"\\?\" + path;
    }

    static string Show(string p) { return p.StartsWith(@"\\?\") ? p.Substring(4) : p; }

    static string Join(string dir, string name) { return dir.EndsWith("\\") ? dir + name : dir + "\\" + name; }

    static string Root(string path)
    {
        string full = Path.GetFullPath(path);
        if (full.Length > 3) full = full.TrimEnd('\\');
        return Long(full);
    }

    static Exception Fail(string longPath, string what)
    {
        int e = Marshal.GetLastWin32Error();
        return new Win32Exception(e, what + " " + Show(longPath) + ": " + new Win32Exception(e).Message);
    }

    // Opens a file or folder as it is: a link is opened itself, never the place it points to.
    static SafeFileHandle Open(string longPath, uint access)
    {
        SafeFileHandle h = CreateFileW(longPath, access, SHARE_ALL, IntPtr.Zero, OPEN_EXISTING, FLAG_BACKUP | FLAG_OPEN_REPARSE, IntPtr.Zero);
        if (h.IsInvalid) { Exception x = Fail(longPath, "Cannot open"); h.Dispose(); throw x; }
        return h;
    }

    static List<Entry> ListDir(string longDir)
    {
        var list = new List<Entry>();
        using (SafeFileHandle h = Open(longDir, FILE_LIST_DIRECTORY | SYNCHRONIZE))
        {
            const int size = 65536;
            IntPtr buf = Marshal.AllocHGlobal(size);
            try
            {
                int cls = 15; // FileFullDirectoryRestartInfo, then FileFullDirectoryInfo
                while (true)
                {
                    if (!GetFileInformationByHandleEx(h, cls, buf, size))
                    {
                        if (Marshal.GetLastWin32Error() == 18) break; // ERROR_NO_MORE_FILES
                        throw Fail(longDir, "Cannot list");
                    }
                    cls = 14;
                    int off = 0;
                    while (true)
                    {
                        IntPtr p = new IntPtr(buf.ToInt64() + off);
                        int next = Marshal.ReadInt32(p, 0);
                        uint attr = (uint)Marshal.ReadInt32(p, 56);
                        int nameBytes = Marshal.ReadInt32(p, 60);
                        string name = Marshal.PtrToStringUni(new IntPtr(p.ToInt64() + 68), nameBytes / 2);
                        if (name != "." && name != "..") list.Add(new Entry { Name = name, Attributes = attr });
                        if (next == 0) break;
                        off += next;
                    }
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        return list;
    }

    static int LinkCount(string longPath)
    {
        using (SafeFileHandle h = Open(longPath, FILE_READ_ATTRIBUTES | SYNCHRONIZE))
        {
            IntPtr buf = Marshal.AllocHGlobal(24);
            try
            {
                if (!GetFileInformationByHandleEx(h, 1, buf, 24)) throw Fail(longPath, "Cannot read"); // FileStandardInfo
                return Marshal.ReadInt32(buf, 16); // NumberOfLinks
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
    }

    // Lines "L<TAB>path<TAB>D|F" for each link and "H<TAB>path<TAB>names" for each file with more than one name (at
    // most maxHard of those). skipTop: names of folders right below root that the walk leaves out.
    public static string[] Scan(string root, string[] skipTop, int maxHard)
    {
        var outp = new List<string>();
        var skip = new HashSet<string>(skipTop ?? new string[0], StringComparer.OrdinalIgnoreCase);
        string lr = Root(root);
        uint rootAttr = GetFileAttributesW(lr);
        if (rootAttr == INVALID_ATTR) return outp.ToArray();
        if ((rootAttr & ATTR_REPARSE) != 0) { outp.Add("L\t" + Show(lr) + "\t" + ((rootAttr & ATTR_DIR) != 0 ? "D" : "F")); return outp.ToArray(); }
        int hard = 0;
        var stack = new Stack<KeyValuePair<string, bool>>();
        stack.Push(new KeyValuePair<string, bool>(lr, true));
        while (stack.Count > 0)
        {
            var item = stack.Pop();
            foreach (Entry e in ListDir(item.Key))
            {
                if (item.Value && skip.Contains(e.Name)) continue;
                string p = Join(item.Key, e.Name);
                bool dir = (e.Attributes & ATTR_DIR) != 0;
                if ((e.Attributes & ATTR_REPARSE) != 0) { outp.Add("L\t" + Show(p) + "\t" + (dir ? "D" : "F")); continue; }
                if (dir) { stack.Push(new KeyValuePair<string, bool>(p, false)); continue; }
                if (hard < maxHard)
                {
                    int n = LinkCount(p);
                    if (n > 1) { outp.Add("H\t" + Show(p) + "\t" + n); hard++; }
                }
            }
        }
        return outp.ToArray();
    }

    // Turns a privilege of this process on or off. True when the process holds it.
    static bool SetPrivilege(string name, bool on)
    {
        IntPtr t;
        if (!OpenProcessToken(GetCurrentProcess(), 0x20 | 0x8, out t)) return false; // TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY
        try
        {
            long luid;
            if (!LookupPrivilegeValueW(null, name, out luid)) return false;
            var tp = new TOKEN_PRIVILEGES { Count = 1, Luid = luid, Attributes = on ? 2 : 0 };
            if (!AdjustTokenPrivileges(t, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero)) return false;
            return Marshal.GetLastWin32Error() == 0; // 1300: not held
        }
        finally { CloseHandle(t); }
    }

    static void DeleteOne(string longPath, uint attr)
    {
        using (SafeFileHandle h = Open(longPath, DELETE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE))
        {
            IntPtr buf = Marshal.AllocHGlobal(40);
            try
            {
                // FileDispositionInfoEx: DELETE | POSIX_SEMANTICS | IGNORE_READONLY_ATTRIBUTE
                Marshal.WriteInt32(buf, 0, 0x1 | 0x2 | 0x10);
                if (SetFileInformationByHandle(h, 21, buf, 4)) return;
                // Older way: take off read-only (FileBasicInfo, times 0 = unchanged), then FileDispositionInfo.
                if ((attr & ATTR_READONLY) != 0)
                {
                    for (int i = 0; i < 40; i++) Marshal.WriteByte(buf, i, 0);
                    uint a = attr & ATTR_SETTABLE & ~ATTR_READONLY;
                    if (a == 0) a = ATTR_NORMAL;
                    Marshal.WriteInt32(buf, 32, (int)a);
                    if (!SetFileInformationByHandle(h, 0, buf, 40)) throw Fail(longPath, "Cannot clear read-only on");
                }
                Marshal.WriteByte(buf, 0, 1);
                if (!SetFileInformationByHandle(h, 4, buf, 1)) throw Fail(longPath, "Cannot delete");
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
    }

    static void DeleteRec(string longPath, uint attr, ref int count)
    {
        if ((attr & ATTR_DIR) != 0 && (attr & ATTR_REPARSE) == 0)
            foreach (Entry e in ListDir(longPath)) DeleteRec(Join(longPath, e.Name), e.Attributes, ref count);
        DeleteOne(longPath, attr);
        count++;
    }

    // Deletes path and everything below it. Returns the number of names deleted (0 when path is not there).
    public static int DeleteTree(string path)
    {
        string lp = Root(path);
        uint attr = GetFileAttributesW(lp);
        if (attr == INVALID_ATTR)
        {
            int e = Marshal.GetLastWin32Error();
            if (e == 2 || e == 3) return 0;
            throw new Win32Exception(e, "Cannot read " + Show(lp) + ": " + new Win32Exception(e).Message);
        }
        bool backup = SetPrivilege("SeBackupPrivilege", true);
        bool restore = SetPrivilege("SeRestorePrivilege", true);
        try
        {
            int count = 0;
            DeleteRec(lp, attr, ref count);
            return count;
        }
        finally
        {
            if (backup) SetPrivilege("SeBackupPrivilege", false);
            if (restore) SetPrivilege("SeRestorePrivilege", false);
        }
    }

    // Deletes everything inside path, but keeps path itself. Returns the number of names deleted.
    public static int EmptyFolder(string path)
    {
        string lp = Root(path);
        uint attr = GetFileAttributesW(lp);
        if (attr == INVALID_ATTR) return 0;
        if ((attr & ATTR_REPARSE) != 0 || (attr & ATTR_DIR) == 0) throw new IOException(Show(lp) + " is not a plain folder.");
        bool backup = SetPrivilege("SeBackupPrivilege", true);
        bool restore = SetPrivilege("SeRestorePrivilege", true);
        try
        {
            int count = 0;
            foreach (Entry e in ListDir(lp)) DeleteRec(Join(lp, e.Name), e.Attributes, ref count);
            return count;
        }
        finally
        {
            if (backup) SetPrivilege("SeBackupPrivilege", false);
            if (restore) SetPrivilege("SeRestorePrivilege", false);
        }
    }

    // ---- One folder's rights, without the walk below ----
    const int DACL_INFO = 4;

    static RawSecurityDescriptor ReadDacl(string path)
    {
        int need;
        GetFileSecurityW(path, DACL_INFO, null, 0, out need);
        if (need <= 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read the rights of " + path);
        var b = new byte[need];
        if (!GetFileSecurityW(path, DACL_INFO, b, need, out need)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read the rights of " + path);
        return new RawSecurityDescriptor(b, 0);
    }

    static void WriteDacl(string path, RawSecurityDescriptor sd)
    {
        // Keep the folder's auto-inherited flag: without "auto-inherit required", Windows drops it.
        if ((sd.ControlFlags & ControlFlags.DiscretionaryAclAutoInherited) != 0)
            sd.SetFlags(sd.ControlFlags | ControlFlags.DiscretionaryAclAutoInheritRequired);
        var b = new byte[sd.BinaryLength];
        sd.GetBinaryForm(b, 0);
        if (!SetFileSecurityW(path, DACL_INFO, b)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot change the rights of " + path);
    }

    static bool IsThisFolderOnly(CommonAce c) { return (c.AceFlags & (AceFlags.Inherited | AceFlags.InheritanceFlags)) == 0; }

    public static bool HasThisFolderDeny(string path, string sid, int mask)
    {
        var s = new SecurityIdentifier(sid);
        foreach (GenericAce a in ReadDacl(path).DiscretionaryAcl)
        {
            var c = a as CommonAce;
            if (c != null && c.SecurityIdentifier == s && c.AceQualifier == AceQualifier.AccessDenied && IsThisFolderOnly(c) && (c.AccessMask & mask) == mask) return true;
        }
        return false;
    }

    // Adds one explicit deny entry for sid, for this folder only. False when it is already there.
    public static bool AddThisFolderDeny(string path, string sid, int mask)
    {
        if (HasThisFolderDeny(path, sid, mask)) return false;
        RawSecurityDescriptor sd = ReadDacl(path);
        RawAcl acl = sd.DiscretionaryAcl;
        acl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessDenied, mask, new SecurityIdentifier(sid), false, null));
        sd.DiscretionaryAcl = acl;
        WriteDacl(path, sd);
        return true;
    }

    // Removes every explicit this-folder-only entry for sid. Returns how many it removed.
    public static int RemoveThisFolderEntries(string path, string sid)
    {
        RawSecurityDescriptor sd = ReadDacl(path);
        RawAcl acl = sd.DiscretionaryAcl;
        var s = new SecurityIdentifier(sid);
        int n = 0;
        for (int i = acl.Count - 1; i >= 0; i--)
        {
            var c = acl[i] as CommonAce;
            if (c != null && c.SecurityIdentifier == s && IsThisFolderOnly(c)) { acl.RemoveAce(i); n++; }
        }
        if (n > 0) { sd.DiscretionaryAcl = acl; WriteDacl(path, sd); }
        return n;
    }

    // ---- Processes ----
    public static string ProcessSid(int pid)
    {
        IntPtr p = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (p == IntPtr.Zero) return null;
        try
        {
            IntPtr t;
            if (!OpenProcessToken(p, 0x8, out t)) return null; // TOKEN_QUERY
            try
            {
                int need;
                GetTokenInformation(t, 1, IntPtr.Zero, 0, out need); // TokenUser
                if (need <= 0) return null;
                IntPtr buf = Marshal.AllocHGlobal(need);
                try
                {
                    if (!GetTokenInformation(t, 1, buf, need, out need)) return null;
                    return new SecurityIdentifier(Marshal.ReadIntPtr(buf)).Value;
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            finally { CloseHandle(t); }
        }
        finally { CloseHandle(p); }
    }
}
'@
}

# ----- Access entries, read without changing anything -----

# The explicit (not inherited) entries for one SID on a file or folder: { Allow = n; Deny = n }.
function Get-ExplicitEntries([string]$Path, [string]$Sid) {
  $acl = Get-Acl -LiteralPath $Path
  $rules = $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])
  $allow = @($rules | Where-Object { $_.IdentityReference.Value -eq $Sid -and $_.AccessControlType -eq 'Allow' }).Count
  $deny = @($rules | Where-Object { $_.IdentityReference.Value -eq $Sid -and $_.AccessControlType -eq 'Deny' }).Count
  [pscustomobject]@{ Allow = $allow; Deny = $deny }
}

$WriteBits = 0x2 -bor 0x4 -bor 0x10 -bor 0x40 -bor 0x100 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor 0x10000000 -bor 0x40000000

# Does a group of the worker user's token have a write right on this folder (explicit or inherited)?
function Test-BroadWrite([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($r.AccessControlType -ne 'Allow') { continue }
    if ($BroadSids -notcontains $r.IdentityReference.Value) { continue }
    if (([int64]$r.FileSystemRights -band $WriteBits) -ne 0) { return $true }
  }
  $false
}

# Windows' own folders at the top of the system drive. The closing never adds anything to them.
$WindowsTopFolders = @('Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Users', 'PerfLogs', 'Recovery',
  'System Volume Information', 'Config.Msi', 'Documents and Settings', 'Boot', 'EFI')

# The top folders of the system drive that let a broad group write, except Windows' own and any folder in $Skip (or
# inside one).
function Get-OpenSystemFolders([string[]]$Skip = @()) {
  $sys = $env:SystemDrive + '\'
  Get-ChildItem -LiteralPath $sys -Directory -Force | Where-Object {
    -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
    -not $_.Name.StartsWith('$') -and
    ($WindowsTopFolders -notcontains $_.Name)
  } | Where-Object {
    $full = $_.FullName
    -not @($Skip | Where-Object { $_ -and (Test-PathInside $full $_) }).Count
  } | Where-Object { Test-BroadWrite $_.FullName } | ForEach-Object { $_.FullName }
}

# The folders right below $Root that take rights from it but do not carry the worker user's deny entry yet. After a
# folder is closed, this list must be empty.
function Get-FoldersMissingDeny([string]$Root, [string]$Sid) {
  foreach ($d in @(Get-ChildItem -LiteralPath $Root -Directory -Force -ErrorAction SilentlyContinue)) {
    if ($d.Name.StartsWith('$') -or $d.Name -eq 'System Volume Information' -or $d.Name -eq 'WindowsApps') { continue }
    if ($d.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    try { $acl = Get-Acl -LiteralPath $d.FullName } catch { Write-Warning "The rights of $($d.FullName) cannot be read: $($_.Exception.Message)"; continue }
    if ($acl.AreAccessRulesProtected) { continue }
    $inherited = $acl.GetAccessRules($false, $true, [Security.Principal.SecurityIdentifier])
    if (-not ($inherited | Where-Object { $_.IdentityReference.Value -eq $Sid -and $_.AccessControlType -eq 'Deny' })) { $d.FullName }
  }
}

# Local fixed NTFS drives other than the system drive, found now.
function Get-DataDriveRoots {
  Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' |
    Where-Object { $_.FileSystem -eq 'NTFS' -and $_.DeviceID -ne $env:SystemDrive } |
    ForEach-Object { $_.DeviceID + '\' } | Sort-Object
}

# The reason when the folder's own rights let a broad group write: an explicit allow, or any allow on a folder that
# takes no rights from above. $null when there is none. Throws when the rights cannot be read.
function Get-OwnBroadWrite([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path
  $prot = $acl.AreAccessRulesProtected
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($r.AccessControlType -ne 'Allow') { continue }
    if ($BroadSids -notcontains $r.IdentityReference.Value) { continue }
    if ($r.IsInherited -and -not $prot) { continue }
    if (([int64]$r.FileSystemRights -band $WriteBits) -eq 0) { continue }
    $how = 'its own entry'
    if ($prot) { $how = 'it takes no rights from above' }
    return "$($r.IdentityReference.Value) may write ($how)"
  }
  $null
}

# Folders under each root, $Depth levels down, that Get-OwnBroadWrite names. Below each such folder the scan goes all
# the way down (up to $DeepCap folders). Skips links, '$' folders, System Volume Information, WindowsApps and every
# path in $Skip (and what is below it). Returns { Path; Why } objects; Why starts with 'unreadable' when the rights
# cannot be read.
function Find-OpenFolders([string[]]$Roots, [int]$Depth, [string[]]$Skip = @(), [int]$DeepCap = 5000) {
  # Long names, so the skip test matches what Get-ChildItem returns.
  $Skip = @($Skip | Where-Object { $_ } | ForEach-Object { if (Test-Path -LiteralPath $_) { (Get-Item -LiteralPath $_ -Force).FullName } else { $_ } })
  $isSkipped = { param($full) foreach ($s in $Skip) { if ($s -and (Test-PathInside $full $s)) { return $true } }; $false }
  $children = {
    param($dir)
    foreach ($c in @(Get-ChildItem -LiteralPath $dir -Directory -Force -ErrorAction SilentlyContinue)) {
      if ($c.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
      if ($c.Name.StartsWith('$') -or $c.Name -eq 'System Volume Information' -or $c.Name -eq 'WindowsApps') { continue }
      if (& $isSkipped $c.FullName) { continue }
      $c.FullName
    }
  }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($root in $Roots) {
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
    $level = @($root)
    for ($d = 1; $d -le $Depth; $d++) {
      $next = New-Object System.Collections.Generic.List[string]
      foreach ($dir in $level) {
        foreach ($c in @(& $children $dir)) {
          $next.Add($c)
          $why = $null
          try { $why = Get-OwnBroadWrite $c } catch { $why = "unreadable: $($_.Exception.Message)" }
          if (-not $why) { continue }
          if (-not $seen.Add($c)) { continue }
          [pscustomobject]@{ Path = $c; Why = $why }
          if ($why.StartsWith('unreadable')) { continue }
          $queue = New-Object System.Collections.Generic.Queue[string]
          $queue.Enqueue($c)
          $count = 0
          while ($queue.Count -and $count -lt $DeepCap) {
            foreach ($g in @(& $children $queue.Dequeue())) {
              $count++
              $queue.Enqueue($g)
              $w = $null
              try { $w = Get-OwnBroadWrite $g } catch { $w = "unreadable: $($_.Exception.Message)" }
              if ($w -and $seen.Add($g)) { [pscustomobject]@{ Path = $g; Why = $w } }
            }
          }
          if ($queue.Count) { Write-Warning "Stopped looking below $c after $DeepCap folders. Folders deeper in it are not checked." }
        }
      }
      $level = @($next)
    }
  }
}

# ----- Links -----

# What under $Root would carry a rights change outside it: links that point outside $Root (icacls /T follows them),
# and files with a second name (hard links share one set of rights). Reads only, never follows a link. $SkipTop:
# folders right below $Root that the walk leaves out. Returns { Outside; Hard }.
function Get-LinkProblems([string]$Root, [string[]]$SkipTop = @()) {
  $outside = New-Object System.Collections.Generic.List[string]
  $hard = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $Root) {
    Initialize-LimitedNative
    foreach ($line in @([FuobeLimitedNative]::Scan($Root, $SkipTop, 20))) {
      $f = $line.Split("`t")
      if ($f[0] -eq 'H') { $hard.Add("$($f[1]) ($($f[2]) names)"); continue }
      $targets = @()
      try { $targets = @((Get-Item -LiteralPath $f[1] -Force).Target | Where-Object { $_ }) } catch { $targets = @() }
      $inside = [bool]$targets.Count
      foreach ($t in $targets) {
        $full = $t
        if (-not [IO.Path]::IsPathRooted($t)) { $full = Join-Path (Split-Path $f[1] -Parent) $t }
        try { if (-not (Test-PathInside $full $Root)) { $inside = $false } } catch { $inside = $false }
      }
      if (-not $inside) {
        $shown = '(target unknown)'
        if ($targets.Count) { $shown = $targets -join ', ' }
        $outside.Add("$($f[1]) -> $shown")
      }
    }
  }
  [pscustomobject]@{ Outside = $outside.ToArray(); Hard = $hard.ToArray() }
}

# Stops when Get-LinkProblems finds anything. $Fix says what to do about it.
function Assert-NoLinkProblems([string]$Root, [string[]]$SkipTop = @(), [string]$Fix = '') {
  $lp = Get-LinkProblems $Root $SkipTop
  if (-not ($lp.Outside.Count + $lp.Hard.Count)) { return }
  foreach ($x in $lp.Outside | Select-Object -First 10) { Write-Note "Link to a place outside: $x" }
  foreach ($x in $lp.Hard | Select-Object -First 10) { Write-Note "File with a second name (hard link): $x" }
  $msg = "Under $Root, $($lp.Outside.Count) link(s) point outside it and $($lp.Hard.Count) file(s) have a second name elsewhere (the first 20 are counted). A rights change here would also change those places."
  if ($lp.Hard.Count) { $msg += ' Copy those files instead of linking them (for pnpm: --package-import-method=copy).' }
  if ($Fix) { $msg += " $Fix" }
  throw $msg
}

# ----- Processes of the worker -----

# Processes that run as the worker user (the worker, its ComfyUI, ffmpeg, the task's cmd.exe). By user only, so a
# program of the person that runs from the same folder is never touched.
function Get-WorkerProcesses([string]$WorkerSid) {
  if (-not $WorkerSid) { return }
  Initialize-LimitedNative
  foreach ($p in @(Get-Process)) {
    if ($p.Id -eq $PID -or $p.Id -le 4) { continue }
    if ([FuobeLimitedNative]::ProcessSid($p.Id) -ne $WorkerSid) { continue }
    $path = $null
    try { $path = $p.Path } catch { $path = $null }
    [pscustomobject]@{ ProcessId = $p.Id; Name = $p.ProcessName; ExecutablePath = $path }
  }
}

# Rights and firewall changes affect a running worker. Stops when it runs, unless $Force.
function Assert-WorkerStopped([string]$TaskPath, [string]$TaskName, [string]$WorkerSid, [bool]$Force, [bool]$WhatIfRun) {
  $running = New-Object System.Collections.Generic.List[string]
  $t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t -and "$($t.State)" -eq 'Running') { $running.Add("the task $TaskPath$TaskName") }
  foreach ($p in @(Get-WorkerProcesses $WorkerSid)) { $running.Add("$($p.Name) (process $($p.ProcessId))") }
  if (-not $running.Count) { Write-Note 'The worker is not running.'; return }
  $msg = "The worker runs now: $($running -join ', '). Stop it first with Stop-LimitedWorker.ps1. -Force goes on anyway."
  if ($Force -or $WhatIfRun) { Write-Warning $msg; return }
  throw $msg
}

# ----- The record of changes outside the root (limited-setup-state.json) -----
# The install writes each place where it puts an entry for the worker user, before it changes that place. The undo
# reads the record and takes each entry off again. The file holds paths and SIDs only.

function Read-SetupState([string]$Path) {
  $state = [ordered]@{ version = 1; workerSid = $null; entries = @(); quota = $null }
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $state }
  $o = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
  $names = @($o.PSObject.Properties | ForEach-Object { $_.Name })
  if ($names -contains 'workerSid') { $state.workerSid = $o.workerSid }
  if ($names -contains 'quota' -and $o.quota) {
    $state.quota = [ordered]@{ volume = $o.quota.volume; sid = $o.quota.sid; user = $o.quota.user; priorState = [int]$o.quota.priorState }
  }
  if ($names -contains 'entries' -and $o.entries) {
    $state.entries = @(@($o.entries) | ForEach-Object { [ordered]@{ path = $_.path; kind = $_.kind; sid = $_.sid } })
  }
  $state
}

function Save-SetupState([string]$Path, $State) {
  Write-Utf8NoBom $Path ((ConvertTo-Json -InputObject $State -Depth 6) + "`n")
}

# Adds one entry (once per path, kind and SID) and saves the record. Kind 'icacls': an entry that icacls /remove takes
# off. Kind 'this-folder': an entry on that folder only (RemoveThisFolderEntries takes it off).
function Add-SetupStateEntry([string]$Path, $State, [string]$Target, [string]$Kind, [string]$Sid) {
  foreach ($e in @($State.entries)) { if ($e.path -ieq $Target -and $e.kind -eq $Kind -and $e.sid -eq $Sid) { return } }
  $State.entries = @(@($State.entries) + @([ordered]@{ path = $Target; kind = $Kind; sid = $Sid }))
  Save-SetupState $Path $State
}

# ----- The result file for a caller that cannot read the console -----
# { ok; exitCode; whatIf; taskEnabled; steps: [{ name; ok; note }]; failed: ["<step>: <why>", ...] }

function New-RunResult([bool]$WhatIfRun) {
  [ordered]@{ ok = $false; exitCode = $null; whatIf = $WhatIfRun; taskEnabled = $false; steps = @(); failed = @() }
}

function Add-StepResult($Result, [string]$Name, [bool]$Ok, [string]$Note = '') {
  $Result.steps = @(@($Result.steps) + @([ordered]@{ name = $Name; ok = $Ok; note = $Note }))
  if (-not $Ok) { $Result.failed = @(@($Result.failed) + @("${Name}: $Note")) }
}

function Save-RunResult([string]$Path, $Result) {
  if (-not $Path) { return }
  Write-Utf8NoBom $Path ((ConvertTo-Json -InputObject $Result -Depth 6) + "`n")
}

# The rows of check-as-worker.json. Windows PowerShell's ConvertFrom-Json hands a JSON list over as ONE object, so
# assign first, then make the list.
function Read-CheckRows([string]$Path) {
  $parsed = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
  @($parsed)
}

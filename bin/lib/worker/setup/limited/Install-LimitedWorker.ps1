<#
.SYNOPSIS
Sets up the Fuobe worker to run as its own limited Windows user, at boot, whether or not anyone is signed in.

.DESCRIPTION
Run it from an elevated PowerShell. With -WhatIf it prints each change and makes none. Each step is safe to run
twice, and a run stops at the first error.

Before it runs, the caller makes this layout under -Root:
  versions\<id>\node\node.exe and versions\<id>\app\bin\fuobe.mjs   the code (-VersionDir is versions\<id>)
  home                                                                worker.json, control.json, logs
  work                                                                job files
  temp                                                                temporary files
This script makes bin and temp (and home and work) when they are missing.

Steps:
1. user       A standard local user (-WorkerUser) with a random password that nobody sees. It is in Users and in
              Performance Monitor Users (the worker reads the GPU memory of other programs). It may log on as a batch
              job, may not sign in at the PC, over Remote Desktop or from the network, and is hidden from the sign-in
              screen.
2. folders    The root takes no rights from above. versions and bin: the worker user reads, the person changes.
              home: both change. work and temp: only the worker user. The worker user reads ComfyUI, its Python,
              the model folders and ffmpeg's folder.
   closed     The places where every user may write get deny entries for the worker user only: the top of each
              fixed data drive, open top folders of the system drive, open folders found below them, in Program
              Files, ProgramData and the Users folder, and "no new files or folders" on the top of the system drive
              and of ProgramData. Folders that the worker must read keep read ("deny any change"). Each change is
              written to <root>\limited-setup-state.json before it is made. On a big drive this takes many minutes.
   quota      Optional (-QuotaMB): a disk quota for the worker user on the system drive.
3. firewall   The ComfyUI Python, when the worker user runs it: this PC only. The worker's node.exe and every program
              of the worker user: this PC and the site on TCP 443. After the per-user rules, it checks that the
              person's own account still reaches -ProbeHost, and removes the per-user rules again when it does not.
4. files      bin\worker.cmd (the worker's commands for the person) and bin\run-worker.cmd (the task's start file).
5. task       The task -TaskPath -TaskName, registered OFF: at boot plus 1 minute, as the worker user with a fresh
              random password given only to the task store, no admin rights, no time limit, one copy at a time.
   check      A check runs once as the worker user. The task is switched ON only when every check line is OK.
6. shortcuts  "Pause Fuobe worker" (Ctrl+Alt+P) and "Resume Fuobe worker" on the person's desktop.

Stop the worker before a second run (Stop-LimitedWorker.ps1), or pass -Force.
Undo: Remove-LimitedWorker.ps1.

Exit codes: 0 done (with -SkipCheck or -WhatIf the task stays OFF), 1 a step stopped with an error (nothing after it
ran), 2 the setup is done but a check line failed, so the task stays OFF.
-ResultFile gets JSON after each step:
  { "ok": bool, "exitCode": 0|1|2|null, "whatIf": bool, "taskEnabled": bool,
    "steps": [ { "name": "...", "ok": bool, "note": "..." } ], "failed": [ "<step>: <why>", ... ] }

.EXAMPLE
.\Install-LimitedWorker.ps1 -Root <root> -VersionDir <root>\versions\<id> -ComfyDir <ComfyUI folder> -ModelDirs <models folder> -Site https://example.com -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Root = '',
  [string]$VersionDir = '',
  [string]$ComfyDir = '',
  [string]$PythonDir = '',
  [string[]]$ModelDirs = @(),
  [string]$Ffmpeg = '',
  [string]$Site = '',
  [string[]]$SiteAddresses = @(),
  [string]$WorkerUser = 'fuobe-worker',
  [string]$OwnerUser = '',
  [string]$TaskPath = '\Fuobe\',
  [string]$TaskName = 'Worker',
  [string[]]$ExcludeFolders = @(),
  [int]$QuotaMB = 0,
  [string]$ProbeHost = 'www.microsoft.com',
  [switch]$NoShortcuts,
  [switch]$SkipCheck,
  [switch]$NoUserRules,
  [switch]$RemoveSignInTask,
  [switch]$Force,
  [string]$LogFile = '',
  [string]$ResultFile = ''
)

. (Join-Path $PSScriptRoot 'common.ps1')

$script:Result = New-RunResult ([bool]$WhatIfPreference)
$script:StepName = 'start'
$script:Transcribing = $false
$script:Plain = $null

function Stop-Run($ErrorRecord) {
  $msg = $ErrorRecord.Exception.Message
  $script:Plain = $null
  Write-Host ''
  Write-Host "Stopped in step '$script:StepName': $msg" -ForegroundColor Red
  if ($ErrorRecord.InvocationInfo -and $ErrorRecord.InvocationInfo.PositionMessage) {
    Write-Host $ErrorRecord.InvocationInfo.PositionMessage -ForegroundColor DarkGray
  }
  Write-Host 'Nothing after this point ran. Fix the cause and run the script again (it is safe to run twice).'
  Add-StepResult $script:Result $script:StepName $false $msg
  $script:Result.ok = $false
  $script:Result.exitCode = 1
  try { Save-RunResult $ResultFile $script:Result } catch { Write-Host "Cannot write ${ResultFile}: $($_.Exception.Message)" -ForegroundColor Red }
  if ($script:Transcribing) { try { Stop-Transcript | Out-Null } catch { } }
  exit 1
}
trap { Stop-Run $_ }

function Start-InstallStep([string]$Name, [string]$Title) {
  $script:StepName = $Name
  Write-Step $Title
}

function Complete-InstallStep([string]$Note = '') {
  Add-StepResult $script:Result $script:StepName $true $Note
  Save-RunResult $ResultFile $script:Result
}

function Test-TcpReach([string]$HostName, [int]$Port, [int]$TimeoutMs = 5000) {
  $c = New-Object Net.Sockets.TcpClient
  try {
    $t = $c.ConnectAsync($HostName, $Port)
    if (-not $t.Wait($TimeoutMs)) { return $false }
    return $c.Connected
  } catch {
    return $false
  } finally {
    $c.Dispose()
  }
}

function Get-FileSystemOf([string]$Path) {
  try { (New-Object IO.DriveInfo([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path)))).DriveFormat } catch { $null }
}

if ($LogFile) {
  Start-Transcript -LiteralPath $LogFile -Append -WhatIf:$false -Confirm:$false | Out-Null
  $script:Transcribing = $true
}
$wi = [bool]$WhatIfPreference
Save-RunResult $ResultFile $script:Result

# ===== Facts =====
Start-InstallStep 'preflight' 'Facts'
Assert-64BitPowerShell
Assert-Admin $wi
if (-not $Root -or -not $VersionDir -or -not $ComfyDir -or -not $Site) { throw '-Root, -VersionDir, -ComfyDir and -Site are required.' }
if ($WorkerUser -notmatch '^[A-Za-z0-9._-]{1,20}$') { throw "-WorkerUser must be 1 to 20 letters, digits, dots, dashes or underscores ($WorkerUser)." }
if (-not $TaskPath.StartsWith('\')) { $TaskPath = '\' + $TaskPath }
if (-not $TaskPath.EndsWith('\')) { $TaskPath = $TaskPath + '\' }
if (-not $TaskName -or $TaskName -eq $CheckTaskName) { throw "-TaskName cannot be empty or '$CheckTaskName'." }
$siteHost = Get-SiteHost $Site
$P = Get-WorkerPaths $Root $VersionDir
$account = "$env:COMPUTERNAME\$WorkerUser"

if (Test-DriveRoot $P.Root) { throw "-Root cannot be a whole drive ($($P.Root)). Give a folder." }
$profilesDir = Split-Path $env:PUBLIC -Parent
if (Test-PathInside $P.Root $profilesDir) { throw "-Root cannot be inside $profilesDir (the user profiles)." }
if (-not (Test-Path -LiteralPath $P.Root -PathType Container)) { throw "$($P.Root) is not there. Make the root and its versions folder first." }
if ((Get-FileSystemOf $P.Root) -ne 'NTFS') { throw "$($P.Root) must be on an NTFS drive: other file systems keep no rights." }
if ($P.VersionDir -ieq $P.Versions -or -not (Test-PathInside $P.VersionDir $P.Versions)) { throw "-VersionDir must be a folder inside $($P.Versions) ($($P.VersionDir))." }
foreach ($f in @($P.NodeExe, $P.FuobeMjs)) { if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "$f is not there." } }
# The command files hold these paths. Building them now stops early on a path they cannot hold.
$workerCmdText = New-WorkerCmdText $P
$runCmdText = New-RunWorkerCmdText $P "$TaskPath$TaskName"

$comfy = Get-FullPath $ComfyDir
if (-not (Test-Path -LiteralPath (Join-Path $comfy 'main.py') -PathType Leaf)) { throw "$comfy has no main.py. Give the ComfyUI folder with -ComfyDir." }
$pyDirFull = ''
if ($PythonDir) { $pyDirFull = Get-FullPath $PythonDir }
$py = Find-WorkerPython $comfy $pyDirFull
if (-not $py) {
  if ($pyDirFull) { throw "$pyDirFull has no python.exe." }
  throw "There is no Python for $comfy (python_embeded beside it, or venv or .venv in it). Give its folder with -PythonDir."
}
$models = @($ModelDirs | Where-Object { $_ } | ForEach-Object { Get-FullPath $_ })
foreach ($d in $models) { if (-not (Test-Path -LiteralPath $d -PathType Container)) { throw "The model folder $d is not there. Connect its drive, or leave it out of -ModelDirs." } }
$ffFull = $null
$ffDir = $null
if ($Ffmpeg) {
  $ffFull = Get-FullPath $Ffmpeg
  if (-not (Test-Path -LiteralPath $ffFull -PathType Leaf)) { throw "There is no ffmpeg at $ffFull." }
  $ffDir = Split-Path $ffFull -Parent
}
$readDirs = @(@($comfy) + @($py.ReadDirs) + $models + @($ffDir) | Where-Object { $_ })
$plan = Get-ReadPlan $readDirs $P @(Get-SystemReadableDirs)
if ($plan.Problems.Count) { throw ($plan.Problems -join ' ') }

$profiles = @(Get-NetFirewallProfile)
if (-not ($profiles | Where-Object { $_.Enabled })) { throw 'Windows Firewall is off for every network type. Turn it on first: the rules do nothing while it is off.' }
foreach ($pr in $profiles) { if (-not $pr.Enabled) { Write-Warning "Windows Firewall is off for the $($pr.Name) network type. The rules do nothing there." } }

$wsid = Get-WorkerSid $WorkerUser
$owner = Resolve-OwnerAccount $OwnerUser $wsid
$ownerProfile = Get-ProfilePath $owner.Sid

$resolved = @()
try { $resolved = @(Resolve-SiteAddresses $siteHost) } catch {
  if (-not @($SiteAddresses | Where-Object { $_ }).Count) { throw "Windows found no address for $siteHost ($($_.Exception.Message)). Check the network, or pass -SiteAddresses." }
  Write-Warning "Windows found no address for $siteHost. The rules use -SiteAddresses as given."
}
$siteRanges = Get-SiteRanges $resolved $SiteAddresses
if ($siteRanges.Source -eq 'resolved') {
  Write-Warning "$siteHost is not behind the known CDN ranges, so the rules allow only its addresses now ($($siteRanges.Ranges -join ', ')). If they change, the worker loses the site: pass -SiteAddresses with its stable ranges."
}
$probeIps = @()
try { $probeIps = @(Resolve-SiteAddresses $ProbeHost) } catch { $probeIps = @() }
foreach ($ip in $probeIps) {
  if (Test-IpInRanges $ip $siteRanges.Ranges) { Write-Warning "-ProbeHost $ProbeHost is at $ip, inside the site ranges. The check would find it reachable. Choose another -ProbeHost." }
}

Write-Note "Root: $($P.Root)"
Write-Note "Code: $($P.VersionDir)"
Write-Note "ComfyUI: $comfy"
Write-Note "Its Python: $($py.Python)$(if ($py.IsVenv) { ' (a venv)' })"
foreach ($d in $models) { Write-Note "Model folder: $d" }
if ($ffFull) { Write-Note "ffmpeg: $ffFull" } else { Write-Note 'ffmpeg: none' }
Write-Note "Site: $siteHost ($($resolved -join ', ')), allowed ranges: $($siteRanges.Ranges.Count) ($($siteRanges.Source))"
Write-Note "Worker user: $account$(if ($wsid) { " ($wsid)" } else { ' (not there yet)' })"
Write-Note "Person's account: $($owner.Name) ($($owner.Sid))"
Write-Note "Task: $TaskPath$TaskName"
Write-Note "Record of changes: $($P.StateFile)"

Write-Step 'Is the worker running?'
Assert-WorkerStopped $TaskPath $TaskName $wsid ([bool]$Force) $wi
Complete-InstallStep "site ranges: $($siteRanges.Source)"

# ===== 1. The worker user =====
Start-InstallStep 'user' "The worker user $account"
$user = Get-LocalUser -Name $WorkerUser -ErrorAction SilentlyContinue
if ($user) {
  Write-Note 'The user is already there. Its password stays; the task step sets a new one.'
} elseif ($PSCmdlet.ShouldProcess($account, 'Make a standard local user with a random password that nobody sees')) {
  $first = ConvertTo-SecureString -String (New-WorkerPassword) -AsPlainText -Force
  New-LocalUser -Name $WorkerUser -Password $first -FullName 'Fuobe worker' -Description 'Runs the Fuobe worker. Nobody signs in as it.' `
    -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires | Out-Null
  $first.Dispose()
  Write-Note 'Made the user.'
}
$wsid = Get-WorkerSid $WorkerUser
if (-not $wsid) {
  if (-not $wi) { throw "Windows does not know $account after it was made." }
  $wsid = 'S-1-5-21-0-0-0-1001'
  Write-Note "With -WhatIf the user is not made. The steps below show their changes with a stand-in SID ($wsid)."
}
$isReal = [bool](Get-LocalUser -Name $WorkerUser -ErrorAction SilentlyContinue)
if ($owner.Sid -eq $wsid) { throw 'The person''s account and the worker user are the same account. Give the person''s account with -OwnerUser.' }
if ($isReal -and (Test-LocalGroupMember $SidAdmins $wsid)) {
  throw "$account is in the Administrators group. The worker must run without admin rights. Take it out of that group, then run this script again."
}
foreach ($g in @($SidUsers, $SidPerfMonUsers)) {
  $gname = (Get-LocalGroup -SID $g).Name
  if ($isReal -and (Test-LocalGroupMember $g $wsid)) { Write-Note "Already in $gname."; continue }
  if ($PSCmdlet.ShouldProcess($account, "Add to the group $gname")) {
    Add-LocalGroupMember -SID $g -Member $wsid
    Write-Note "Added to $gname."
  }
}
Initialize-Lsa
$have = @()
if ($isReal -and -not $wi) { $have = @([FuobeLimitedLsa]::Get($wsid)) }
foreach ($right in $WorkerRights.Keys) {
  if ($have -contains $right) { Write-Note "Already set: $($WorkerRights[$right])."; continue }
  if ($PSCmdlet.ShouldProcess($account, "$($WorkerRights[$right]) ($right)")) {
    [FuobeLimitedLsa]::Add($wsid, $right)
    Write-Note "Set: $($WorkerRights[$right])."
  }
}
$listKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
$hidden = $false
if (Test-Path $listKey) {
  $v = Get-ItemProperty -Path $listKey -Name $WorkerUser -ErrorAction SilentlyContinue
  $hidden = $v -and ($v.$WorkerUser -eq 0)
}
if ($hidden) {
  Write-Note 'Already hidden from the sign-in screen.'
} elseif ($PSCmdlet.ShouldProcess("$listKey\$WorkerUser", 'Set the value 0 (hide the user from the sign-in screen)')) {
  if (-not (Test-Path $listKey)) { New-Item -Path $listKey -Force | Out-Null }
  New-ItemProperty -Path $listKey -Name $WorkerUser -Value 0 -PropertyType DWord -Force | Out-Null
  Write-Note 'Hidden from the sign-in screen.'
}
Complete-InstallStep "sid $wsid"

# ===== 2. Folders and rights =====
Start-InstallStep 'folders' 'Folders and rights under the root'
$W = "*$wsid"
$O = "*$($owner.Sid)"
$S = "*$SidSystem"
$A = "*$SidAdmins"
$state = Read-SetupState $P.StateFile
if (-not $wi -and $state.workerSid -ne $wsid) { $state.workerSid = $wsid; Save-SetupState $P.StateFile $state }

foreach ($d in @($P.Bin, $P.WorkerHome, $P.Work, $P.Temp)) {
  if (Test-Path -LiteralPath $d) { Write-Note "There: $d"; continue }
  if ($PSCmdlet.ShouldProcess($d, 'Make the folder')) { New-Item -ItemType Directory -Path $d | Out-Null; Write-Note "Made: $d" }
}

Write-Note 'Looking for links and hard links in the code part ...'
Assert-NoLinkProblems $P.Root $DataFolderNames 'Fix that, then run this script again.'

foreach ($d in @($P.WorkerHome, $P.Work, $P.Temp)) {
  $isHome = ($d -eq $P.WorkerHome)
  $ready = $false
  if (Test-Path -LiteralPath $d) {
    $acl = Get-Acl -LiteralPath $d
    $ready = $acl.AreAccessRulesProtected -and ((Get-ExplicitEntries $d $wsid).Allow -gt 0)
    if ($isHome) { $ready = $ready -and ((Get-ExplicitEntries $d $owner.Sid).Allow -gt 0) }
    else { $ready = $ready -and ((Get-ExplicitEntries $d $owner.Sid).Allow -eq 0) }
  }
  if ($ready) { Write-Note "Already set: $d"; continue }
  # The worker may have written here: never follow a link out of it, never change a file with a second name.
  Assert-NoLinkProblems $d @() "Delete those links in $d, then run this script again."
  $grants = @("${S}:(OI)(CI)F", "${A}:(OI)(CI)F", "${W}:(OI)(CI)M")
  $what = 'The worker user: change. The person: no access. Not content indexed'
  if ($isHome) { $grants += "${O}:(OI)(CI)M"; $what = 'The worker user and the person: change' }
  if ($PSCmdlet.ShouldProcess($d, "$what. No rights from the folder above")) {
    Invoke-Icacls (@($d, '/inheritance:r', '/grant:r') + $grants)
    if (-not $isHome) { Invoke-Native -FilePath "$env:SystemRoot\System32\attrib.exe" -ArgumentList @('+I', $d) | Out-Null }
    Write-Note "Set: $d"
  }
}

if ($PSCmdlet.ShouldProcess($P.Root, 'No rights from the folder above. SYSTEM and Administrators: full. The worker user and the person: read')) {
  Invoke-Icacls @($P.Root, '/inheritance:r', '/grant:r', "${S}:(OI)(CI)F", "${A}:(OI)(CI)F", "${W}:(OI)(CI)RX", "${O}:(OI)(CI)RX")
}
foreach ($item in @(Get-ChildItem -LiteralPath $P.Root -Force | Where-Object { $DataFolderNames -notcontains $_.Name })) {
  $isDir = $item.PSIsContainer
  if ($PSCmdlet.ShouldProcess($item.FullName, 'Take only the rights of the root (icacls /reset)')) {
    if ($isDir) { Invoke-Icacls @($item.FullName, '/reset', '/T', '/C', '/Q') } else { Invoke-Icacls @($item.FullName, '/reset', '/Q') }
  }
}
foreach ($d in @($P.Versions, $P.Bin)) {
  if (-not (Test-Path -LiteralPath $d) -and -not $wi) { continue }
  if ($PSCmdlet.ShouldProcess($d, 'The person: change (code). The worker user keeps read only')) {
    Invoke-Icacls @($d, '/grant', "${O}:(OI)(CI)M")
  }
}

Write-Step 'Read rights for the worker user outside the root'
foreach ($s in $plan.Skip) { Write-Note "No entry needed: $($s.Path) ($($s.Why))" }
foreach ($d in $plan.Grant) {
  if ((Get-FileSystemOf $d) -ne 'NTFS') { Write-Warning "$d is not on an NTFS drive, so it keeps no rights: every user, the worker user too, can change it."; continue }
  if ((Get-ExplicitEntries $d $wsid).Allow -gt 0) { Write-Note "Already readable for the worker user: $d"; continue }
  if ($PSCmdlet.ShouldProcess($d, 'The worker user: read and list (this folder and all below)')) {
    Add-SetupStateEntry $P.StateFile $state $d 'icacls' $wsid
    Invoke-Icacls @($d, '/grant', "${W}:(OI)(CI)RX")
    Write-Note "Readable: $d"
  }
}
Complete-InstallStep "$($plan.Grant.Count) read folder(s)"

# ===== 2b. Closed places =====
Start-InstallStep 'closed-places' 'Places where every user may write: closed to the worker user'
$keepRead = @($plan.Grant) + @($plan.Skip | ForEach-Object { $_.Path }) + @((Join-Path $env:ProgramData 'NVIDIA Corporation'))
$excluded = @($ExcludeFolders | Where-Object { $_ } | ForEach-Object { Get-FullPath $_ })
$closedCount = New-Object System.Collections.Generic.List[string]

# Puts one inherited deny entry for the worker user on a folder. On a second run it puts the entry on again only
# when a folder right below did not get it (an earlier run stopped partway).
function Close-Folder([string]$Path, [string]$Mask, [string]$What) {
  $e = $null
  try { $e = Get-ExplicitEntries $Path $wsid } catch {
    if ($wi) { Write-Warning "Cannot read the rights of $Path from this PowerShell: $($_.Exception.Message)"; return }
    throw
  }
  $closedCount.Add($Path)
  if ($e.Deny -gt 0) {
    $gaps = @(Get-FoldersMissingDeny $Path $wsid)
    if (-not $gaps.Count) { Write-Note "Already closed: $Path"; return }
    Write-Note "$Path has the entry, but these folders below did not get it: $(($gaps | Select-Object -First 5) -join ', ')"
    if ($PSCmdlet.ShouldProcess($Path, 'Take the deny entry off and put it on again, so Windows copies it to every file')) {
      Invoke-Icacls @($Path, '/remove:d', $W)
    }
  }
  if ($PSCmdlet.ShouldProcess($Path, "$What $Mask")) {
    Add-SetupStateEntry $P.StateFile $state $Path 'icacls' $wsid
    Invoke-Icacls @($Path, '/deny', "${W}:(OI)(CI)$Mask")
    Write-Note "Closed: $Path"
  }
}

function Test-Excluded([string]$Path) { [bool]@($excluded | Where-Object { Test-PathInside $Path $_ }).Count }

$sys = $env:SystemDrive + '\'
$roots = @(Get-DataDriveRoots | Where-Object { -not (Test-Excluded $_) })
foreach ($r in $roots) {
  Close-Folder $r $DenyAll 'Deny the worker user all use of the whole drive (Windows applies it to every file; this can take many minutes):'
}
$topSkip = @($P.Root) + $excluded
foreach ($f in @(Get-OpenSystemFolders $topSkip)) {
  $mask = Get-CloseMask $f $keepRead
  $what = 'Deny the worker user all use:'
  if ($mask -eq $DenyWrite) { $what = 'Deny the worker user any change (it keeps read):' }
  Close-Folder $f $mask $what
}
$skip = @($P.Root, (Join-Path $env:ProgramData 'Microsoft'), (Join-Path $env:ProgramData 'Packages')) + $excluded
$driveSkip = $skip + @($WindowsTopFolders | ForEach-Object { Join-Path $sys $_ })
Write-Note 'Looking for open folders: the data drives and the system drive (3 levels down), Program Files and ProgramData (2 levels down), the Users folder (1 level down) ...'
$found = @(Find-OpenFolders (@($roots) + @($sys)) 3 $driveSkip)
$found += @(Find-OpenFolders @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData) 2 $skip)
$found += @(Find-OpenFolders @($profilesDir) 1 $skip)
if (-not $found.Count) { Write-Note 'None found.' }
foreach ($x in $found) {
  if ($x.Why.StartsWith('unreadable')) { Write-Warning "$($x.Path): its rights cannot be read ($($x.Why))."; continue }
  $mask = Get-CloseMask $x.Path $keepRead
  $what = "Deny the worker user all use ($($x.Why)):"
  if ($mask -eq $DenyWrite) { $what = "Deny the worker user any change; it keeps read ($($x.Why)):" }
  Close-Folder $x.Path $mask $what
}

Write-Step 'No new files or folders at the top of the system drive and of ProgramData'
Initialize-LimitedNative
foreach ($t in @($sys, $env:ProgramData)) {
  $has = $false
  try { $has = [FuobeLimitedNative]::HasThisFolderDeny($t, $wsid, $DenyCreateMask) } catch { if (-not $wi) { throw } }
  if ($has) { Write-Note "Already set: $t"; continue }
  if ($PSCmdlet.ShouldProcess($t, 'Deny the worker user making files and folders in this folder only (nothing below changes)')) {
    Add-SetupStateEntry $P.StateFile $state $t 'this-folder' $wsid
    [FuobeLimitedNative]::AddThisFolderDeny($t, $wsid, $DenyCreateMask) | Out-Null
    Write-Note "Set: $t"
  }
}
$open = 0
if (-not $wi) {
  foreach ($c in @($closedCount | Select-Object -Unique)) {
    if ((Get-ExplicitEntries $c $wsid).Deny -lt 1) { Write-Warning "No deny entry on $c."; $open++; continue }
    $gaps = @(Get-FoldersMissingDeny $c $wsid)
    if ($gaps.Count) { Write-Warning "These folders below $c do not carry the deny entry: $(($gaps | Select-Object -First 5) -join ', ')."; $open++ }
  }
  Write-Note "Closed places with their deny entry: $(@($closedCount | Select-Object -Unique).Count - $open) of $(@($closedCount | Select-Object -Unique).Count)"
}
if ($open) { throw "$open closed place(s) miss their deny entry. Run this script again." }
Complete-InstallStep "$(@($closedCount | Select-Object -Unique).Count) place(s)"

# ===== 2c. Disk quota (optional) =====
if ($QuotaMB -gt 0) {
  Start-InstallStep 'quota' "A disk quota on $sys for the worker user: $QuotaMB MB"
  $dq = $null
  try {
    $dq = New-Object -ComObject Microsoft.DiskQuota.1
    $dq.Initialize($sys, $true)
    $dq.UserNameResolution = 0
  } catch {
    if (-not $wi) { throw "Cannot open the disk quotas of ${sys}: $($_.Exception.Message)" }
    Write-Warning "Cannot read the disk quotas of $sys from this PowerShell ($($_.Exception.Message))."
    $dq = $null
  }
  $prior = -1
  if ($dq) {
    $prior = [int]$dq.QuotaState
    if ($prior -lt 2) {
      # Turning quotas on must limit no other account: no default limit, and no other entry with a limit.
      if ([double]$dq.DefaultQuotaLimit -ge 0) { throw "$sys has a default quota limit ($($dq.DefaultQuotaLimitText)). Enforcing quotas would limit every account. Leave -QuotaMB out." }
      foreach ($u in $dq) {
        if ([double]$u.QuotaLimit -ge 0 -and $u.LogonName -ine $account) { throw "$sys has a quota limit for $($u.LogonName). Enforcing quotas would limit that account. Leave -QuotaMB out." }
      }
    }
  }
  if ($prior -lt 2 -and $PSCmdlet.ShouldProcess($sys, 'Turn on disk quotas (enforced). Every other account keeps no limit')) {
    $state.quota = [ordered]@{ volume = $sys; sid = $wsid; user = $account; priorState = $prior }
    Save-SetupState $P.StateFile $state
    $dq.QuotaState = 2
    Write-Note 'Quotas are on.'
  }
  if ($PSCmdlet.ShouldProcess("$account on $sys", "Quota: a warning at $([int]($QuotaMB * 0.75)) MB, a limit at $QuotaMB MB")) {
    if (-not $state.quota) { $state.quota = [ordered]@{ volume = $sys; sid = $wsid; user = $account; priorState = $prior }; Save-SetupState $P.StateFile $state }
    $u = $null
    try { $u = $dq.FindUser($account) } catch { $u = $null }
    if (-not $u) { $u = $dq.AddUser($account) }
    $u.QuotaThreshold = [double]([int64]$QuotaMB * 768KB)
    $u.QuotaLimit = [double]([int64]$QuotaMB * 1MB)
    Write-Note "Set: $($u.QuotaThresholdText) warning, $($u.QuotaLimitText) limit."
  }
  Complete-InstallStep "$QuotaMB MB"
}

# ===== 3. Firewall =====
Start-InstallStep 'firewall' 'Firewall rules'
$prefix = $FirewallRulePrefix + (Get-Date -Format 'yyyyMMddHHmmss') + '-'
$site = @($siteRanges.Ranges)
$notLoop = @((Get-ComplementRanges $LoopbackRanges 4) + (Get-ComplementRanges $LoopbackRanges 6))
$notSite = @((Get-ComplementRanges ($LoopbackRanges + $site) 4) + (Get-ComplementRanges ($LoopbackRanges + $site) 6))
$notHttps = @('1-442', '444-65535')
$sddl = "D:(A;;CC;;;$wsid)"
$userRules = -not $NoUserRules
if ($NoUserRules) {
  Write-Warning "-NoUserRules: every program of $WorkerUser other than node.exe and python.exe reaches the whole internet. Use it for a test only."
}
if ($userRules -and -not $wi -and -not (Test-TcpReach $ProbeHost 443)) {
  throw "This PC cannot reach $ProbeHost on port 443 now, so the script cannot make sure that the per-user rules leave the person's account alone. Run it again when the internet works."
}

function Add-BlockRule([string]$Name, [string]$Display, [hashtable]$Spec, [string]$RuleGroup) {
  if ($PSCmdlet.ShouldProcess($Name, "Block: $Display")) {
    New-NetFirewallRule -Name $Name -DisplayName "Fuobe worker: $Display" -Group $RuleGroup -Action Block -Profile Any -Enabled True `
      -Description 'Made by Install-LimitedWorker.ps1. Undo: Remove-LimitedWorker.ps1 -Only Firewall.' @Spec | Out-Null
    Write-Note "Added: $Display"
  }
}

# The Python rules name the worker user too, so the person's own use of the same Python keeps its network.
$i = 0
foreach ($f in $py.Files) {
  $i++
  $leaf = Split-Path $f -Leaf
  Write-Note "ComfyUI Python: $f"
  Add-BlockRule "${prefix}Python$i-Out" "ComfyUI $leaf ($i), as the worker user, reaches only this PC (out)" @{ Direction = 'Outbound'; Program = $f; LocalUser = $sddl; RemoteAddress = $notLoop } $FirewallGroup
  # The inbound rule is a second guard (the worker's ComfyUI listens on 127.0.0.1). A Windows that refuses a user
  # condition on an inbound rule gets a warning, not a stop.
  try {
    Add-BlockRule "${prefix}Python$i-In" "ComfyUI $leaf ($i), as the worker user, takes connections only from this PC (in)" @{ Direction = 'Inbound'; Program = $f; LocalUser = $sddl; RemoteAddress = $notLoop } $FirewallGroup
  } catch {
    Write-Warning "The inbound rule for $f was not added: $($_.Exception.Message)"
  }
}
Write-Note "Worker node.exe: $($P.NodeExe)"
Add-BlockRule "${prefix}Node-Out" 'node reaches only this PC and the site (out)' @{ Direction = 'Outbound'; Program = $P.NodeExe; RemoteAddress = $notSite } $FirewallGroup
Add-BlockRule "${prefix}Node-NotHttps" 'node reaches the site only on TCP 443' @{ Direction = 'Outbound'; Program = $P.NodeExe; Protocol = 'TCP'; RemotePort = $notHttps; RemoteAddress = $site } $FirewallGroup
Add-BlockRule "${prefix}Node-Udp" 'node sends no UDP to the site' @{ Direction = 'Outbound'; Program = $P.NodeExe; Protocol = 'UDP'; RemoteAddress = $site } $FirewallGroup
Add-BlockRule "${prefix}Node-In" 'node takes connections only from this PC (in)' @{ Direction = 'Inbound'; Program = $P.NodeExe; RemoteAddress = $notLoop } $FirewallGroup

if ($userRules) {
  Add-BlockRule "${prefix}User-Out" "user $WorkerUser reaches only this PC and the site (out)" @{ Direction = 'Outbound'; LocalUser = $sddl; RemoteAddress = $notSite } $FirewallUserGroup
  Add-BlockRule "${prefix}User-NotHttps" "user $WorkerUser reaches the site only on TCP 443" @{ Direction = 'Outbound'; LocalUser = $sddl; Protocol = 'TCP'; RemotePort = $notHttps; RemoteAddress = $site } $FirewallUserGroup
  Add-BlockRule "${prefix}User-Udp" "user $WorkerUser sends no UDP to the site" @{ Direction = 'Outbound'; LocalUser = $sddl; Protocol = 'UDP'; RemoteAddress = $site } $FirewallUserGroup
  if (-not $wi) {
    Start-Sleep -Seconds 2
    if (-not (Test-TcpReach $ProbeHost 443)) {
      Get-NetFirewallRule -Group $FirewallUserGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
      throw "After the per-user rules, the person's account could not reach $ProbeHost. The script removed every per-user rule again. Do not run jobs on this PC until this is solved."
    }
    Write-Note "The person's account still reaches $ProbeHost on port 443."
  }
}
foreach ($g in @($FirewallGroup, $FirewallUserGroup)) {
  $old = @(Get-NetFirewallRule -Group $g -ErrorAction SilentlyContinue | Where-Object { -not $_.Name.StartsWith($prefix) })
  if (-not $old.Count) { continue }
  if ($PSCmdlet.ShouldProcess("$($old.Count) earlier rule(s) in '$g'", 'Remove (the new ones are in place)')) {
    $old | Remove-NetFirewallRule
    Write-Note "Removed $($old.Count) earlier rule(s) in '$g'."
  }
}
$fwNote = "$($site.Count) site range(s)"
if (-not $userRules) { $fwNote += '; no per-user rules (test only)' }
Complete-InstallStep $fwNote

# ===== 4. Command files =====
Start-InstallStep 'files' 'Command files in bin'
if ($PSCmdlet.ShouldProcess($P.WorkerCmd, 'Write the file (the worker''s commands for the person)')) {
  Write-AsciiFile $P.WorkerCmd $workerCmdText
  Write-Note "Wrote $($P.WorkerCmd)."
}
if ($PSCmdlet.ShouldProcess($P.RunCmd, 'Write the file (the start file of the task)')) {
  Write-AsciiFile $P.RunCmd $runCmdText
  Write-Note "Wrote $($P.RunCmd)."
}
Complete-InstallStep

# ===== 5. The task and the check =====
Start-InstallStep 'task' "The task $TaskPath$TaskName (registered OFF)"
$signIn = Get-ScheduledTask -TaskName $SignInTaskName -ErrorAction SilentlyContinue
if ($signIn) {
  if ($RemoveSignInTask) {
    foreach ($t in @($signIn)) {
      if ($PSCmdlet.ShouldProcess("$($t.TaskPath)$($t.TaskName)", 'Remove the sign-in task of the normal install')) {
        Unregister-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName -Confirm:$false
        Write-Note "Removed $($t.TaskPath)$($t.TaskName)."
      }
    }
  } else {
    Write-Warning "There is also a task '$SignInTaskName' that runs the worker as $(@($signIn)[0].Principal.UserId) at sign-in. Two workers would run. Remove it, or run this script with -RemoveSignInTask."
  }
}

# What the check must be able to use, and what must stay closed.
$closedList = New-Object System.Collections.Generic.List[string]
$noWriteList = New-Object System.Collections.Generic.List[string]
foreach ($r in $roots) { $closedList.Add($r) }
if ($ownerProfile) { $closedList.Add($ownerProfile) }
foreach ($f in @(Get-OpenSystemFolders $topSkip)) {
  if ((Get-CloseMask $f $keepRead) -eq $DenyWrite) { $noWriteList.Add($f) } else { $closedList.Add($f) }
}
$noWriteList.Add($sys)
$noWriteList.Add($env:ProgramData)
foreach ($e in @($state.entries)) {
  if ($e.kind -eq 'this-folder') { $noWriteList.Add($e.path); continue }
  if (-not (Test-Path -LiteralPath $e.path)) { continue }
  $hasDeny = $false
  $denyRead = $false
  try {
    foreach ($r in (Get-Acl -LiteralPath $e.path).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {
      if ($r.IdentityReference.Value -ne $e.sid -or $r.AccessControlType -ne 'Deny') { continue }
      $hasDeny = $true
      if (([int64]$r.FileSystemRights -band 0x1) -ne 0) { $denyRead = $true }
    }
  } catch { continue }
  if (-not $hasDeny) { continue }
  if ($denyRead) { $closedList.Add($e.path) } else { $noWriteList.Add($e.path) }
}
$checkReadDirs = @($readDirs | Where-Object { $_ -ine $ffDir } | Select-Object -Unique)
$checkInput = [ordered]@{
  canWrite    = @($P.WorkerHome, $P.Work, $P.Temp)
  cannotWrite = @($P.Root, $P.Versions, $P.VersionDir, $P.Bin)
  readDirs    = $checkReadDirs
  ffmpeg      = $ffFull
  closed      = @($closedList | Select-Object -Unique | Select-Object -First 60)
  noWrite     = @($noWriteList | Select-Object -Unique | Select-Object -First 60)
  python      = $py.Python
  nodeExe     = $P.NodeExe
  probeHost   = $ProbeHost
  siteHost    = $siteHost
  tempDir     = $P.Temp
}
Write-Note "The check looks at $($checkInput.closed.Count) closed places and $($checkInput.noWrite.Count) read-only places."
if ($PSCmdlet.ShouldProcess($P.CheckPs1, 'Copy check-as-worker.ps1 and write its input check-input.json')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'check-as-worker.ps1') -Destination $P.CheckPs1 -Force
  Write-Utf8NoBom $P.CheckIn ((ConvertTo-Json -InputObject $checkInput -Depth 4) + "`n")
}

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/d /c `"$($P.RunCmd)`"" -WorkingDirectory $P.Work
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT1M'
# -Disable: registered OFF. Only a check where every line says OK switches it on.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Disable
$description = 'Runs the Fuobe worker as its own limited user at boot. Made by Install-LimitedWorker.ps1. Undo: Remove-LimitedWorker.ps1.'
$checkArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$($P.CheckPs1)`" -In `"$($P.CheckIn)`" -Out `"$($P.CheckOut)`""
$checkAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $checkArgs -WorkingDirectory $P.WorkerHome

$checkBad = 0
try {
  if ($PSCmdlet.ShouldProcess($account, 'Set a new random password (never shown, kept only by the task store)')) {
    $script:Plain = New-WorkerPassword
    Set-LocalUser -Name $WorkerUser -Password (ConvertTo-SecureString -String $script:Plain -AsPlainText -Force)
    Write-Note 'Set a new password.'
  }
  if ($PSCmdlet.ShouldProcess("$TaskPath$TaskName", "Register OFF: at boot plus 1 minute, as $account, no admin rights, no time limit, one copy")) {
    Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action -Trigger $trigger -Settings $settings `
      -User $account -Password $script:Plain -RunLevel Limited -Description $description -Force | Out-Null
    Write-Note 'Registered, switched off.'
  }
  Complete-InstallStep 'registered OFF'

  Start-InstallStep 'check' 'Check as the worker user'
  if ($SkipCheck) {
    Write-Warning "-SkipCheck: the task stays OFF. After a check of your own: Enable-ScheduledTask -TaskPath '$TaskPath' -TaskName '$TaskName'"
    Complete-InstallStep 'skipped; the task stays OFF'
  } elseif ($PSCmdlet.ShouldProcess("$TaskPath$CheckTaskName", 'Run the check once as the worker user, then remove the check task')) {
    if (Test-Path -LiteralPath $P.CheckOut) { Remove-Item -LiteralPath $P.CheckOut -Force }
    $checkSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName $CheckTaskName -TaskPath $TaskPath -Action $checkAction -Settings $checkSettings -User $account -Password $script:Plain -RunLevel Limited -Force | Out-Null
    try {
      Start-ScheduledTask -TaskName $CheckTaskName -TaskPath $TaskPath
      $until = (Get-Date).AddSeconds(180)
      while ((Get-Date) -lt $until) {
        $t = Get-ScheduledTask -TaskName $CheckTaskName -TaskPath $TaskPath
        if ((Test-Path -LiteralPath $P.CheckOut) -and "$($t.State)" -ne 'Running') { break }
        Start-Sleep -Seconds 2
      }
      if (-not (Test-Path -LiteralPath $P.CheckOut)) {
        $info = Get-ScheduledTaskInfo -TaskName $CheckTaskName -TaskPath $TaskPath
        throw "The check as the worker user wrote no result in 180 seconds (last result: $($info.LastTaskResult)). The task stays OFF."
      }
    } finally {
      Unregister-ScheduledTask -TaskName $CheckTaskName -TaskPath $TaskPath -Confirm:$false -ErrorAction SilentlyContinue
    }
    $rows = @(Read-CheckRows $P.CheckOut)
    foreach ($r in $rows) {
      $mark = 'OK     '
      if (-not $r.ok) {
        $mark = 'PROBLEM'
        $checkBad++
        $why = "$($r.name): got $($r.got)"
        if ($r.note) { $why += " ($($r.note))" }
        $script:Result.failed = @(@($script:Result.failed) + @("check: $why"))
      }
      $extra = ''
      if ($r.note) { $extra = "  ($($r.note))" }
      Write-Note ("{0} {1}: {2}{3}" -f $mark, $r.name, $r.got, $extra)
    }
    if ($rows.Count -lt 10) {
      $checkBad++
      $script:Result.failed = @(@($script:Result.failed) + @("check: only $($rows.Count) line(s); something stopped it early"))
      Write-Warning "The check wrote only $($rows.Count) line(s). Something stopped it early."
    }
    if ($checkBad) {
      Write-Warning "$checkBad check line(s) failed. The task $TaskPath$TaskName stays OFF."
      Add-StepResult $script:Result 'check' $false "$checkBad line(s) failed; the task stays OFF"
      Save-RunResult $ResultFile $script:Result
    } else {
      Enable-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath | Out-Null
      $script:Result.taskEnabled = $true
      Write-Note "Every check line passed ($($rows.Count) lines). The task is switched ON. It starts at the next boot."
      Complete-InstallStep "$($rows.Count) lines OK; the task is ON"
    }
  } else {
    Complete-InstallStep 'not run (-WhatIf)'
  }
} finally {
  $script:Plain = $null
}

# ===== 6. Shortcuts =====
Start-InstallStep 'shortcuts' 'Pause and resume shortcuts on the person''s desktop'
if ($NoShortcuts) {
  Write-Note 'Left out (-NoShortcuts).'
  Complete-InstallStep 'left out'
} else {
  $desktop = Get-DesktopPath $owner.Sid
  if (-not $desktop -or -not (Test-Path -LiteralPath $desktop)) {
    Write-Warning "The desktop of $($owner.Name) was not found. No shortcuts."
    Complete-InstallStep 'no desktop found'
  } else {
    # Name, arguments, hotkey, window style (1: a normal window for the question, 7: minimized).
    foreach ($s in @(@($ShortcutNames[0], 'pause --choose', 'CTRL+ALT+P', 1), @($ShortcutNames[1], 'resume', '', 7))) {
      $lnk = Join-Path $desktop ($s[0] + '.lnk')
      $hot = ''
      if ($s[2]) { $hot = ", hotkey $($s[2])" }
      if ($PSCmdlet.ShouldProcess($lnk, "Shortcut: $($P.WorkerCmd) $($s[1])$hot")) {
        $shell = New-Object -ComObject WScript.Shell
        $l = $shell.CreateShortcut($lnk)
        $l.TargetPath = $P.WorkerCmd
        $l.Arguments = $s[1]
        $l.WorkingDirectory = $P.WorkerHome
        $l.WindowStyle = $s[3]
        if ($s[2]) { $l.Hotkey = $s[2] }
        $l.Save()
        Write-Note "Made: $lnk"
      }
    }
    Complete-InstallStep $desktop
  }
}

# ===== Done =====
$script:StepName = 'done'
Write-Step 'Done'
if ($wi) { Write-Note 'Nothing changed (-WhatIf).' }
if ($checkBad) { $script:Result.exitCode = 2 } else { $script:Result.exitCode = 0 }
$script:Result.ok = ($script:Result.exitCode -eq 0)
Save-RunResult $ResultFile $script:Result
if ($script:Result.taskEnabled) {
  Write-Note "Start the worker now: Start-ScheduledTask -TaskPath '$TaskPath' -TaskName '$TaskName' (or restart the PC)."
} else {
  Write-Note 'The task is OFF.'
}
Write-Note "Its log: $($P.Log)"
if ($script:Transcribing) { try { Stop-Transcript | Out-Null } catch { } }
exit $script:Result.exitCode

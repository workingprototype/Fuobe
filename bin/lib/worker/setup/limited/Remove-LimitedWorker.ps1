<#
.SYNOPSIS
Undoes Install-LimitedWorker.ps1: all of it, or the parts named with -Only.

.DESCRIPTION
Parts, in the order the script undoes them:
- Task       Stops and removes the task (and a left-over check task), ends every process of the worker user, and
             deletes bin\run-worker.cmd and the check files.
- Shortcuts  Deletes "Pause Fuobe worker" and "Resume Fuobe worker" from the person's desktop when they point to this
             root's bin\worker.cmd.
- Firewall   Removes the rules in the two rule groups that the install made.
- Folders    Takes off every entry for the worker user that <root>\limited-setup-state.json names (read entries,
             deny entries, the entries on the top of the system drive and of ProgramData), and looks for such entries
             in the usual places that the record may miss. Sets the disk quota back when the install set one.
             Empties work and temp (job files that only the worker user can open; -KeepJobFiles keeps them), then
             gives the root the rights of the folder above it again. Deletes the record when nothing is left in it.
             It never deletes ComfyUI, its Python, the model folders, the code, or home.
- User       Removes the user rights, the sign-in screen entry, the user's profile and the user. It stops while any
             place still names the user, so no entry is left without a name.
It is safe to run twice: a part that is already gone is skipped. Run it from an elevated PowerShell. -WhatIf shows
each change and makes none.

Exit codes: 0 done, 1 a part stopped with an error (nothing after it ran). -ResultFile gets the same JSON shape as
Install-LimitedWorker.ps1.

.EXAMPLE
.\Remove-LimitedWorker.ps1 -Root <root> -WhatIf
.\Remove-LimitedWorker.ps1 -Root <root> -Only Firewall
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Root = '',
  [string[]]$Only = @('Task', 'Shortcuts', 'Firewall', 'Folders', 'User'),
  [string]$WorkerUser = 'fuobe-worker',
  [string]$WorkerSid = '',
  [string]$OwnerUser = '',
  [string]$TaskPath = '\Fuobe\',
  [string]$TaskName = 'Worker',
  [string[]]$ExtraPlaces = @(),
  [switch]$KeepJobFiles,
  [switch]$Force,
  [string]$LogFile = '',
  [string]$ResultFile = ''
)

. (Join-Path $PSScriptRoot 'common.ps1')

$script:Result = New-RunResult ([bool]$WhatIfPreference)
$script:StepName = 'start'
$script:Transcribing = $false

function Stop-Run($ErrorRecord) {
  $msg = $ErrorRecord.Exception.Message
  Write-Host ''
  Write-Host "Stopped in part '$script:StepName': $msg" -ForegroundColor Red
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

function Start-Part([string]$Name, [string]$Title) { $script:StepName = $Name; Write-Step $Title }
function Complete-Part([string]$Note = '') {
  Add-StepResult $script:Result $script:StepName $true $Note
  Save-RunResult $ResultFile $script:Result
}

if ($LogFile) {
  Start-Transcript -LiteralPath $LogFile -Append -WhatIf:$false -Confirm:$false | Out-Null
  $script:Transcribing = $true
}
$wi = [bool]$WhatIfPreference

Start-Part 'preflight' 'Undo: facts'
Assert-64BitPowerShell
Assert-Admin $wi
Initialize-LimitedNative
if (-not $Root) { throw '-Root is required.' }
$parts = @('Task', 'Shortcuts', 'Firewall', 'Folders', 'User')
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($o in $Only) { if ($parts -notcontains $o) { throw "-Only takes $($parts -join ', '). '$o' is not one of them." } }
if (-not $TaskPath.StartsWith('\')) { $TaskPath = '\' + $TaskPath }
if (-not $TaskPath.EndsWith('\')) { $TaskPath = $TaskPath + '\' }
$P = Get-WorkerPaths $Root
$state = Read-SetupState $P.StateFile
$sys = $env:SystemDrive + '\'

$sid = Get-WorkerSid $WorkerUser
if ($WorkerSid -and $sid -and $sid -ne $WorkerSid) { throw "-WorkerSid $WorkerSid is not the SID of $WorkerUser ($sid)." }
if (-not $sid -and $WorkerSid) { $sid = $WorkerSid }
if (-not $sid -and $state.workerSid) { $sid = $state.workerSid }
$recordSids = @(@($state.entries | ForEach-Object { $_.sid }) + @($(if ($state.quota) { $state.quota.sid })) | Where-Object { $_ } | Select-Object -Unique)
if (-not $sid -and $recordSids.Count -eq 1) { $sid = $recordSids[0] }
if (-not $sid -and (Get-LocalUser -Name $WorkerUser -ErrorAction SilentlyContinue)) { throw "Windows cannot give the SID of $WorkerUser." }
if (-not $sid -and (($Only -contains 'Folders') -or ($Only -contains 'User'))) {
  Write-Warning "There is no user $WorkerUser, and the record names no SID. Entries that name it are skipped. If the user was there before, give its SID with -WorkerSid."
}
Write-Note "Parts: $($Only -join ', ')"
Write-Note "Root: $($P.Root)"
Write-Note "Worker user: $WorkerUser ($(if ($sid) { $sid } else { 'not there' }))"
Write-Note "Record: $($P.StateFile) ($(@($state.entries).Count) entries$(if ($state.quota) { ', a disk quota' }))"
if ((($Only -contains 'Folders') -or ($Only -contains 'User')) -and -not ($Only -contains 'Task')) {
  Assert-WorkerStopped $TaskPath $TaskName $sid ([bool]$Force) $wi
}
Complete-Part

# The explicit entries for $EntrySid on $Path, or $null when they cannot be read (a warning in -WhatIf).
function Get-EntriesOrNull([string]$Path, [string]$EntrySid) {
  try { Get-ExplicitEntries $Path $EntrySid } catch {
    if ($wi) { Write-Warning "Cannot read the rights of $Path from this PowerShell: $($_.Exception.Message)"; return $null }
    throw
  }
}

# Takes every explicit entry for $EntrySid off $Path. True when nothing is left.
function Remove-EntriesAt([string]$Path, [string]$Kind, [string]$EntrySid, [string]$What) {
  $e = Get-EntriesOrNull $Path $EntrySid
  if ($null -eq $e) { return $false }
  if (-not ($e.Allow + $e.Deny)) { Write-Note "No entry on $Path."; return $true }
  if (-not $PSCmdlet.ShouldProcess($Path, "Remove the worker user's entries ($What)")) { return $false }
  if ($Kind -eq 'this-folder') { [FuobeLimitedNative]::RemoveThisFolderEntries($Path, $EntrySid) | Out-Null } else { Invoke-Icacls @($Path, '/remove', "*$EntrySid") }
  Write-Note "Removed: $Path"
  $true
}

# The usual places of the install, for entries that the record does not name.
function Get-UsualPlaces {
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($r in @(Get-DataDriveRoots)) { $list.Add(@($r, 'icacls')) }
  foreach ($f in @(Get-ChildItem -LiteralPath $sys -Directory -Force | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and -not $_.Name.StartsWith('$') -and ($WindowsTopFolders -notcontains $_.Name) })) {
    $list.Add(@($f.FullName, 'icacls'))
  }
  foreach ($x in @($ExtraPlaces | Where-Object { $_ })) { $list.Add(@((Get-FullPath $x), 'icacls')) }
  $list.Add(@($sys, 'this-folder'))
  $list.Add(@($env:ProgramData, 'this-folder'))
  $list
}

if ($Only -contains 'Task') {
  Start-Part 'Task' 'Task, processes, start file'
  foreach ($n in @($TaskName, $CheckTaskName)) {
    $t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $n -ErrorAction SilentlyContinue
    if (-not $t) { Write-Note "No task $TaskPath$n."; continue }
    if ($PSCmdlet.ShouldProcess("$TaskPath$n", 'Stop and remove the task')) {
      Stop-ScheduledTask -TaskPath $TaskPath -TaskName $n -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $n -Confirm:$false
      Write-Note "Removed $TaskPath$n."
    }
  }
  $folderName = $TaskPath.Trim('\')
  if ($folderName) {
    $svc = New-Object -ComObject Schedule.Service
    $svc.Connect()
    $folder = $null
    try { $folder = $svc.GetFolder($TaskPath.TrimEnd('\')) } catch { $folder = $null }
    if ($folder -and $folder.GetTasks(1).Count -eq 0 -and $folder.GetFolders(0).Count -eq 0) {
      if ($PSCmdlet.ShouldProcess($TaskPath, 'Remove the empty task folder')) {
        $parent = Split-Path ('\' + $folderName) -Parent
        if (-not $parent) { $parent = '\' }
        $svc.GetFolder($parent).DeleteFolder((Split-Path ('\' + $folderName) -Leaf), 0)
        Write-Note "Removed the folder $TaskPath."
      }
    }
  }
  # cmd.exe first: it would start the worker again.
  foreach ($proc in @(Get-WorkerProcesses $sid | Sort-Object { if ($_.Name -eq 'cmd') { 0 } else { 1 } })) {
    if ($PSCmdlet.ShouldProcess("$($proc.Name) (process $($proc.ProcessId)) $($proc.ExecutablePath)", 'End the process')) {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Note "Ended $($proc.Name) ($($proc.ProcessId))."
    }
  }
  foreach ($f in @($P.RunCmd, $P.CheckPs1, $P.CheckIn, $P.CheckOut)) {
    if ((Test-Path -LiteralPath $f) -and $PSCmdlet.ShouldProcess($f, 'Delete the file')) { Remove-Item -LiteralPath $f -Force; Write-Note "Deleted $f." }
  }
  Complete-Part
}

if ($Only -contains 'Shortcuts') {
  Start-Part 'Shortcuts' 'Desktop shortcuts'
  $owner = $null
  try { $owner = Resolve-OwnerAccount $OwnerUser $sid } catch { Write-Warning $_.Exception.Message }
  $desktop = $null
  if ($owner) { $desktop = Get-DesktopPath $owner.Sid }
  if (-not $desktop -or -not (Test-Path -LiteralPath $desktop)) {
    Write-Note 'No desktop found. Nothing to delete.'
  } else {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($name in $ShortcutNames) {
      $lnk = Join-Path $desktop ($name + '.lnk')
      if (-not (Test-Path -LiteralPath $lnk)) { continue }
      if ($shell.CreateShortcut($lnk).TargetPath -ine $P.WorkerCmd) { Write-Note "Kept $lnk (it points somewhere else)."; continue }
      if ($PSCmdlet.ShouldProcess($lnk, 'Delete the shortcut')) { Remove-Item -LiteralPath $lnk -Force; Write-Note "Deleted $lnk." }
    }
  }
  Complete-Part
}

if ($Only -contains 'Firewall') {
  Start-Part 'Firewall' 'Firewall rules'
  foreach ($g in @($FirewallGroup, $FirewallUserGroup)) {
    $rules = @(Get-NetFirewallRule -Group $g -ErrorAction SilentlyContinue)
    if (-not $rules.Count) { Write-Note "No rules in '$g'."; continue }
    if ($PSCmdlet.ShouldProcess("$($rules.Count) rule(s) in '$g'", 'Remove')) { $rules | Remove-NetFirewallRule; Write-Note "Removed $($rules.Count) rule(s) in '$g'." }
  }
  Complete-Part
}

if ($Only -contains 'Folders') {
  Start-Part 'Folders' 'Entries for the worker user that the install recorded'
  if (-not @($state.entries).Count) { Write-Note 'The record names no entry.' }
  $missing = 0
  foreach ($e in @($state.entries)) {
    if (-not (Test-Path -LiteralPath $e.path)) {
      Write-Warning "$($e.path) is not there now (a drive that is not connected?). The record keeps it: connect it and run -Only Folders again."
      $missing++
      continue
    }
    $what = 'Windows updates every file below: on a drive this takes minutes'
    if ($e.kind -eq 'this-folder') { $what = 'this folder only; nothing below changes' }
    if (Remove-EntriesAt $e.path $e.kind $e.sid $what) {
      if (-not $wi) {
        $state.entries = @(@($state.entries) | Where-Object { -not ($_.path -ieq $e.path -and $_.kind -eq $e.kind -and $_.sid -eq $e.sid) })
        Save-SetupState $P.StateFile $state
      }
    }
  }

  if ($sid) {
    Write-Step 'Entries in the usual places that the record does not name'
    foreach ($u in @(Get-UsualPlaces)) {
      if (-not (Test-Path -LiteralPath $u[0])) { continue }
      $e = Get-EntriesOrNull $u[0] $sid
      if ($null -eq $e -or -not ($e.Allow + $e.Deny)) { continue }
      Remove-EntriesAt $u[0] $u[1] $sid 'not in the record' | Out-Null
    }
    Write-Note 'Done looking.'
  }

  if ($state.quota) {
    $q = $state.quota
    Write-Step "The disk quota on $($q.volume)"
    $dq = $null
    try {
      $dq = New-Object -ComObject Microsoft.DiskQuota.1
      $dq.Initialize($q.volume, $true)
      $dq.UserNameResolution = 0
    } catch {
      if (-not $wi) { throw "Cannot open the disk quotas of $($q.volume): $($_.Exception.Message)" }
      Write-Warning "Cannot read the disk quotas of $($q.volume) from this PowerShell ($($_.Exception.Message))."
      $dq = $null
    }
    $done = $true
    if ($dq) {
      $u = $null
      try { $u = $dq.FindUser($q.user) } catch { $u = $null }
      if ($u) {
        if ($PSCmdlet.ShouldProcess("$($q.user) on $($q.volume)", 'No quota limit for the worker user, and take its quota entry off')) {
          $u.QuotaThreshold = [double]-1
          $u.QuotaLimit = [double]-1
          try { $dq.DeleteUser($u); Write-Note 'Took the quota entry off.' } catch { Write-Note "No limit any more. The entry stays while the user owns files on $($q.volume)." }
        } else { $done = $false }
      } else {
        Write-Note "No quota entry for $($q.user)."
      }
      $prior = [int]$q.priorState
      $names = @('off', 'tracked, not enforced', 'enforced')
      if ($prior -ge 0 -and $prior -lt 2 -and [int]$dq.QuotaState -eq 2) {
        if ($PSCmdlet.ShouldProcess($q.volume, "Set disk quotas back to how they were: $($names[$prior])")) {
          $dq.QuotaState = $prior
          Write-Note "Quotas on $($q.volume): $($names[$prior]) again."
        } else { $done = $false }
      }
    } else { $done = $false }
    if ($done -and -not $wi) { $state.quota = $null; Save-SetupState $P.StateFile $state }
  }

  Write-Step 'The root'
  if (Test-Path -LiteralPath $P.Root) {
    $scanSkip = @()
    if (-not $KeepJobFiles) {
      foreach ($d in @($P.Work, $P.Temp)) {
        if (-not (Test-Path -LiteralPath $d)) { continue }
        if ($PSCmdlet.ShouldProcess($d, 'Delete everything in it (job files of the worker user; links are deleted, never followed)')) {
          $n = [FuobeLimitedNative]::EmptyFolder($d)
          Write-Note "Emptied: $d ($n names)"
        }
      }
      if ($wi) { $scanSkip = @('work', 'temp') }
    }
    # The install sets own rights on the root and on home, work and temp. Reset when any of them still has them.
    $protected = $null
    try {
      $protected = $false
      foreach ($d in @($P.Root, $P.WorkerHome, $P.Work, $P.Temp)) {
        if ((Test-Path -LiteralPath $d) -and (Get-Acl -LiteralPath $d).AreAccessRulesProtected) { $protected = $true }
      }
    } catch { if (-not $wi) { throw }; $protected = $null; Write-Warning "Cannot read the rights under $($P.Root) from this PowerShell." }
    if ($protected -eq $false) {
      Write-Note "$($P.Root) already takes its rights from the folder above. Kept as it is."
    } elseif ($protected) {
      Write-Note 'Looking for links and hard links before the reset ...'
      Assert-NoLinkProblems $P.Root $scanSkip 'Fix that first, then run this script again.'
      if ($PSCmdlet.ShouldProcess($P.Root, 'Give the root and everything in it the rights of the folder above again (icacls /reset /T)')) {
        Invoke-Icacls @($P.Root, '/reset', '/T', '/C', '/Q')
        Write-Note "Reset: $($P.Root)"
      }
    }
  } else {
    Write-Note "Not there: $($P.Root)"
  }

  if (-not $wi -and -not @($state.entries).Count -and -not $state.quota -and (Test-Path -LiteralPath $P.StateFile)) {
    Remove-Item -LiteralPath $P.StateFile -Force
    Write-Note "Every recorded change is undone. Deleted $($P.StateFile)."
  }
  $note = ''
  if ($missing) { $note = "$missing recorded place(s) not there now; the record keeps them" }
  Complete-Part $note
}

if ($Only -contains 'User') {
  Start-Part 'User' 'The worker user'
  if ($sid -and -not ($wi -and ($Only -contains 'Folders'))) {
    # No entry may stay behind without a name: the record must be empty, and the usual places must not name the user.
    $left = New-Object System.Collections.Generic.List[string]
    foreach ($e in @($state.entries)) { $left.Add($e.path) }
    if ($state.quota) { $left.Add("the disk quota on $($state.quota.volume)") }
    foreach ($u in @(Get-UsualPlaces)) {
      if (-not (Test-Path -LiteralPath $u[0])) { continue }
      $e = $null
      try { $e = Get-ExplicitEntries $u[0] $sid } catch { $e = $null }
      if ($e -and ($e.Allow + $e.Deny)) { $left.Add($u[0]) }
    }
    $left = @($left | Select-Object -Unique)
    if ($left.Count) { throw "These places still name the worker user: $(($left | Select-Object -First 10) -join ', '). Run -Only Folders first (connect every drive), so no entry is left without a name." }
  }
  $listKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
  if ((Test-Path $listKey) -and (Get-ItemProperty -Path $listKey -Name $WorkerUser -ErrorAction SilentlyContinue)) {
    if ($PSCmdlet.ShouldProcess("$listKey\$WorkerUser", 'Delete the value')) { Remove-ItemProperty -Path $listKey -Name $WorkerUser; Write-Note 'Deleted the sign-in screen entry.' }
  }
  if ($sid) {
    Initialize-Lsa
    $have = @()
    if (-not $wi) { $have = @([FuobeLimitedLsa]::Get($sid)) }
    foreach ($right in $WorkerRights.Keys) {
      if (-not $wi -and $have -notcontains $right) { continue }
      if ($PSCmdlet.ShouldProcess($WorkerUser, "Remove the right: $($WorkerRights[$right]) ($right)")) { [FuobeLimitedLsa]::Remove($sid, $right); Write-Note "Removed: $right" }
    }
    $userProfile = Get-CimInstance Win32_UserProfile -Filter "SID='$sid'" -ErrorAction SilentlyContinue
    if ($userProfile) {
      if ($userProfile.Loaded) { throw "The profile of $WorkerUser is still loaded. Restart the PC, then run -Only User again." }
      if ($PSCmdlet.ShouldProcess($userProfile.LocalPath, 'Delete the user profile')) { $userProfile | Remove-CimInstance; Write-Note "Deleted $($userProfile.LocalPath)." }
    } else {
      Write-Note 'No user profile.'
    }
  }
  if (Get-LocalUser -Name $WorkerUser -ErrorAction SilentlyContinue) {
    if ($PSCmdlet.ShouldProcess($WorkerUser, 'Delete the local user')) { Remove-LocalUser -Name $WorkerUser; Write-Note "Deleted the user $WorkerUser." }
  } else {
    Write-Note "No user $WorkerUser."
  }
  Complete-Part
}

$script:StepName = 'done'
Write-Step 'Done'
if ($wi) { Write-Note 'Nothing changed (-WhatIf).' }
$script:Result.ok = $true
$script:Result.exitCode = 0
Save-RunResult $ResultFile $script:Result
if ($script:Transcribing) { try { Stop-Transcript | Out-Null } catch { } }
exit 0

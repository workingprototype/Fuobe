<#
.SYNOPSIS
Stops the Fuobe worker that runs as its limited user: its job goes back in line, its ComfyUI stops, and no process of
the worker user is left.

.DESCRIPTION
- Pauses the worker at once (<root>\bin\worker.cmd pause --now). Its job goes back in line and the worker stops its
  ComfyUI. The pause stays until "worker.cmd resume". -NoPause leaves this out.
- Waits up to -WaitSeconds for the worker's ComfyUI to stop.
- Stops the task. Task Scheduler ends only the task's cmd.exe, so the script then ends every process that runs as
  the worker user (the worker's node, its ComfyUI's Python, ffmpeg). Processes of other users are never touched.
- -Disable also switches the task off, so it does not start at the next boot.
It changes no file and no right. It is safe to run twice. Run it from an elevated PowerShell. -WhatIf shows each
change and makes none.

Exit codes: 0 stopped, 1 an error or a worker process is still running. -ResultFile gets the same JSON shape as
Install-LimitedWorker.ps1.

.EXAMPLE
.\Stop-LimitedWorker.ps1 -Root <root> -Disable
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Root = '',
  [string]$WorkerUser = 'fuobe-worker',
  [string]$TaskPath = '\Fuobe\',
  [string]$TaskName = 'Worker',
  [int]$WaitSeconds = 60,
  [switch]$NoPause,
  [switch]$Disable,
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
  Write-Host "Stopped in step '$script:StepName': $msg" -ForegroundColor Red
  Add-StepResult $script:Result $script:StepName $false $msg
  $script:Result.ok = $false
  $script:Result.exitCode = 1
  try { Save-RunResult $ResultFile $script:Result } catch { Write-Host "Cannot write ${ResultFile}: $($_.Exception.Message)" -ForegroundColor Red }
  if ($script:Transcribing) { try { Stop-Transcript | Out-Null } catch { } }
  exit 1
}
trap { Stop-Run $_ }

if ($LogFile) {
  Start-Transcript -LiteralPath $LogFile -Append -WhatIf:$false -Confirm:$false | Out-Null
  $script:Transcribing = $true
}
$wi = [bool]$WhatIfPreference

$script:StepName = 'preflight'
Write-Step 'Stop the worker: facts'
Assert-64BitPowerShell
Assert-Admin $wi
if (-not $Root) { throw '-Root is required.' }
if (-not $TaskPath.StartsWith('\')) { $TaskPath = '\' + $TaskPath }
if (-not $TaskPath.EndsWith('\')) { $TaskPath = $TaskPath + '\' }
$P = Get-WorkerPaths $Root
$wsid = Get-WorkerSid $WorkerUser
$task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) { Write-Note "Task: $TaskPath$TaskName, $($task.State)" } else { Write-Note "No task $TaskPath$TaskName." }
$procs = @(Get-WorkerProcesses $wsid)
Write-Note "Processes of the worker user now: $($procs.Count)"
foreach ($p in $procs) { Write-Note "  $($p.Name) (process $($p.ProcessId)) $($p.ExecutablePath)" }
Add-StepResult $script:Result 'preflight' $true "$($procs.Count) process(es)"

$script:StepName = 'pause'
if ($NoPause) {
  Write-Step 'Pause: left out (-NoPause)'
  Add-StepResult $script:Result 'pause' $true 'left out'
} else {
  Write-Step 'Pause the worker at once'
  if (Test-Path -LiteralPath $P.WorkerCmd) {
    if ($PSCmdlet.ShouldProcess($P.WorkerCmd, 'pause --now (its job goes back in line, its ComfyUI stops; the pause stays until resume)')) {
      $paused = $true
      try { Invoke-Native -FilePath $P.WorkerCmd -ArgumentList @('pause', '--now') | ForEach-Object { Write-Note $_ } } catch {
        $paused = $false
        Write-Warning "The pause did not work ($($_.Exception.Message)). The script ends the processes anyway."
      }
      if ($paused -and $procs.Count) {
        Write-Note "Waiting up to $WaitSeconds seconds for the worker's ComfyUI to stop ..."
        $until = (Get-Date).AddSeconds($WaitSeconds)
        while ((Get-Date) -lt $until) {
          if (-not @(Get-WorkerProcesses $wsid | Where-Object { $_.Name -match '^pythonw?$' }).Count) { break }
          Start-Sleep -Seconds 2
        }
        if (@(Get-WorkerProcesses $wsid | Where-Object { $_.Name -match '^pythonw?$' }).Count) {
          Write-Warning "The worker's ComfyUI still runs after $WaitSeconds seconds. The script ends it now."
        } else {
          Write-Note "The worker's ComfyUI stopped."
        }
      }
    }
    Add-StepResult $script:Result 'pause' $true ''
  } else {
    Write-Note "There is no $($P.WorkerCmd): nothing to pause."
    Add-StepResult $script:Result 'pause' $true 'no worker.cmd'
  }
}

$script:StepName = 'stop'
Write-Step 'Stop the task and end the processes'
if ($task -and "$($task.State)" -eq 'Running') {
  if ($PSCmdlet.ShouldProcess("$TaskPath$TaskName", 'Stop the task')) {
    Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    Write-Note 'Stopped the task.'
  }
} else {
  Write-Note 'The task does not run.'
}
# cmd.exe first: it would start the worker again.
$left = @(Get-WorkerProcesses $wsid | Sort-Object { if ($_.Name -eq 'cmd') { 0 } else { 1 } })
foreach ($p in $left) {
  if ($PSCmdlet.ShouldProcess("$($p.Name) (process $($p.ProcessId)) $($p.ExecutablePath)", 'End the process')) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Note "Ended $($p.Name) ($($p.ProcessId))."
  }
}
if (-not $left.Count) { Write-Note 'No process of the worker user runs.' }
if ($Disable -and $task) {
  if ($PSCmdlet.ShouldProcess("$TaskPath$TaskName", 'Switch the task off (it does not start at the next boot)')) {
    Disable-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName | Out-Null
    Write-Note 'Switched the task off.'
  }
}

if ($wi) {
  Write-Note 'Nothing changed (-WhatIf).'
} else {
  Start-Sleep -Seconds 2
  $still = @(Get-WorkerProcesses $wsid)
  foreach ($p in $still) { Write-Warning "Still running: $($p.Name) (process $($p.ProcessId)) $($p.ExecutablePath)" }
  Write-Note "Processes of the worker user left: $($still.Count)"
  if ($still.Count) { throw "$($still.Count) process(es) of the worker user still run. Run this script again." }
}
Add-StepResult $script:Result 'stop' $true ''
$script:Result.ok = $true
$script:Result.exitCode = 0
Save-RunResult $ResultFile $script:Result
if ($script:Transcribing) { try { Stop-Transcript | Out-Null } catch { } }
exit 0

<#
.SYNOPSIS
Registers a scheduled task that starts WSL at Windows startup, with no logon.

.DESCRIPTION
WSL otherwise starts from the Startup shortcut "Start WSL (fogbelt).lnk", so it
runs only after a logon. This script registers the task "aleph start WSL"
(task root folder, trigger: at startup) that runs
`wsl.exe -d <distro> --exec sleep infinity`. That boots the distro and keeps the
VM alive; systemd services alone do not, because WSL stops the distro when the
last wsl.exe session ends. Inside the distro systemd then brings up
aleph-ui.service and aleph-tick.timer.

The task runs as the current user (WSL distros are per user) with
-LogonType Password, so it runs whether the user is logged on or not. The
password is read with Read-Host -AsSecureString and is never written to a file.

Run it once from an elevated PowerShell:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\start-wsl-at-boot.ps1

Switches:
    -Distro <name>  distro to start (default: first line of `wsl.exe -l -q`)
    -Remove         unregister the task
    -Status         show the task state, last run, last result, distro running?

With no switch it registers the task, replacing an existing one of the same
name, so a second run is safe. The Startup shortcut can stay: a second wsl.exe
on an already running distro is harmless.
#>
[CmdletBinding()]
param(
    [string]$Distro,
    [switch]$Remove,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
$TaskName = 'aleph start WSL'

function Get-DefaultDistro {
    $lines = @(& wsl.exe -l -q) | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ }
    if (-not $lines) { throw 'wsl.exe -l -q listed no distro; pass -Distro <name>.' }
    return $lines[0]
}

if ($Status) {
    $task = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Host "Task '$TaskName': does not exist"
    } else {
        $info = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath '\'
        Write-Host "Task '$TaskName': exists"
        Write-Host "State:       $($task.State)"
        Write-Host "Last run:    $($info.LastRunTime)"
        Write-Host "Last result: $($info.LastTaskResult)"
    }
    $running = @(& wsl.exe -l --running) | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ }
    Write-Host 'Running distros (wsl.exe -l --running):'
    if ($running) { $running | ForEach-Object { Write-Host "  $_" } } else { Write-Host '  none' }
    exit 0
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error 'This script must run in an elevated PowerShell (Run as administrator).' -ErrorAction Continue
    exit 1
}

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false
        Write-Host "Removed task '$TaskName'."
    } else {
        Write-Host "Task '$TaskName' does not exist; nothing to remove."
    }
    exit 0
}

if (-not $Distro) { $Distro = Get-DefaultDistro }

$user = "$env:USERDOMAIN\$env:USERNAME"
$secure = Read-Host -AsSecureString "Windows password for $user"
$cred = New-Object System.Management.Automation.PSCredential($user, $secure)

$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $Distro --exec sleep infinity"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Password -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false }

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -InputObject $task `
    -User $user -Password ([Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))) | Out-Null

Write-Host "Registered task '$TaskName': wsl.exe -d $Distro --exec sleep infinity at startup, as $user."

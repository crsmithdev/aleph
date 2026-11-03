# Start at boot

After a power loss, WSL starts only when someone logs on to Windows, so `aleph.home` and the factory tick stay down until then. Inside WSL the units are enabled and linger is on, so the start of the distro is the only missing step. A Windows scheduled task starts the distro at boot. You register it once, from an elevated PowerShell.

## Register the task

1. Open PowerShell as administrator.
2. Go to the script and run it:
   ```powershell
   pushd \\wsl$\Ubuntu-24.04\home\crsmi\aleph\jobs\windows
   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-wsl-at-boot.ps1
   ```
   If the UNC path fails, copy the file to a Windows folder and run it there.
3. Type the Windows password once at the prompt. The task scheduler stores it; no file holds it.

## Check it

```powershell
.\start-wsl-at-boot.ps1 -Status
```

This shows the task state, its last run, its last result and the running distros.

The real test is a restart of Windows without a logon, then a later logon. Then `http://aleph.home/` answers, and in WSL `systemctl --user list-timers aleph-tick.timer` shows the timer.

## Remove it

```powershell
.\start-wsl-at-boot.ps1 -Remove
```

Run it from an elevated PowerShell. The Startup shortcut can stay.

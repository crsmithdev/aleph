// The sandbox has no PowerShell, so this reads the script as text and asserts
// the contract; a text test is the oracle that fits.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ps = readFileSync(join(import.meta.dir, "start-wsl-at-boot.ps1"), "utf8");

describe("start-wsl-at-boot.ps1", () => {
  test("names the task and triggers at startup", () => {
    expect(ps).toContain("'aleph start WSL'");
    expect(ps).toContain("New-ScheduledTaskTrigger -AtStartup");
  });
  test("runs wsl.exe with sleep infinity as the current user with a password logon", () => {
    expect(ps).toMatch(/wsl\.exe/);
    expect(ps).toContain("--exec sleep infinity");
    expect(ps).toContain("$env:USERDOMAIN\\$env:USERNAME");
    expect(ps).toContain("-LogonType Password");
  });
  test("settings", () => {
    expect(ps).toContain("-AllowStartIfOnBatteries");
    expect(ps).toContain("-DontStopIfGoingOnBatteries");
    expect(ps).toContain("-ExecutionTimeLimit ([TimeSpan]::Zero)");
    expect(ps).toContain("-RestartCount 3");
    expect(ps).toContain("-Hidden");
  });
  test("asks for the password securely and never stores a literal one", () => {
    expect(ps).toContain("Read-Host -AsSecureString");
    expect(ps).not.toMatch(/ConvertTo-SecureString\s+.*-AsPlainText/i);
    expect(ps).not.toMatch(/-Password\s+['"]/);
    expect(ps).not.toMatch(/Out-File|Set-Content|Add-Content/);
  });
  test("has -Remove, -Status, -Distro and the elevation check", () => {
    expect(ps).toContain("[switch]$Remove");
    expect(ps).toContain("[switch]$Status");
    expect(ps).toContain("[string]$Distro");
    expect(ps).toContain("wsl.exe -l --running");
    expect(ps).toContain("[Security.Principal.WindowsPrincipal]");
    expect(ps).toContain("IsInRole");
    expect(ps).toMatch(/exit 1/);
  });
  test("header gives the run command", () => {
    expect(ps).toContain("powershell -NoProfile -ExecutionPolicy Bypass -File .\\start-wsl-at-boot.ps1");
  });
});

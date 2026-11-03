// Archived goal tests from jobs/windows/start-wsl-at-boot.test.ts: `bun run accept` runs them, `bun run test` does not.
// The sandbox has no PowerShell, so this reads the script as text and asserts
// the contract; a text test is the oracle that fits.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ps = readFileSync(join((import.meta.dir + "/../../../jobs/windows"), "start-wsl-at-boot.ps1"), "utf8");

describe("start-wsl-at-boot.ps1", () => {
  test("runs wsl.exe with sleep infinity as the current user with a password logon", () => {
    expect(ps).toMatch(/wsl\.exe/);
    expect(ps).toContain("--exec sleep infinity");
    expect(ps).toContain("$env:USERDOMAIN\\$env:USERNAME");
    expect(ps).toContain("-LogonType Password");
  });
  test("asks for the password securely and never stores a literal one", () => {
    expect(ps).toContain("Read-Host -AsSecureString");
    expect(ps).not.toMatch(/ConvertTo-SecureString\s+.*-AsPlainText/i);
    expect(ps).not.toMatch(/-Password\s+['"]/);
    expect(ps).not.toMatch(/Out-File|Set-Content|Add-Content/);
  });
});

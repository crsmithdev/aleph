#!/usr/bin/env bun
/**
 * Notification hook: desktop toast.
 *
 * Fires on Claude Code notification events (idle, permission, complete).
 *
 * 1. Parse event type from stdin JSON.
 * 2. Map event to a human-readable message (fallback: generic attention message).
 * 3. Detect platform: WSL (via /proc/version) or native macOS.
 * 4. WSL → PowerShell toast notification via Windows.UI.Notifications.
 *    macOS → osascript display notification.
 * 5. On failure → fall back to terminal bell (\x07).
 *
 * Never blocks. Does not exit non-zero on notification failure.
 */
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "notify-event-toast";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) {
  const msg = `[${TAG}] stdin parse failed: ${(e as Error).message}`;
  console.error(msg);
  trace(TAG, msg);
  process.exit(1);
}
reportHook(TAG, "Notification", input.session_id);
const event = input.type ?? "unknown";
trace(TAG, `event: ${event}`);

const messages: Record<string, string> = {
  idle: "Claude is waiting for input",
  permission: "Claude needs permission to proceed",
  complete: "Claude finished the task",
};
const msg = messages[event] ?? "Claude Code needs your attention";
trace(TAG, `message: ${msg}`);

const isWSL = (() => {
  try { return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft"); } catch { return false; }
})();
trace(TAG, `platform: ${isWSL ? "WSL" : "native"}`);

try {
  if (isWSL) {
    const xml = `<toast><visual><binding template="ToastText01"><text id="1">${msg}</text></binding></visual></toast>`;
    execSync(`powershell.exe -Command "
      $doc=[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]::new()
      $doc.LoadXml('${xml}')
      $t=[Windows.UI.Notifications.ToastNotification,Windows.UI.Notifications,ContentType=WindowsRuntime]::new($doc)
      [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]::CreateToastNotifier('Claude Code').Show($t)
    "`, { stdio: "ignore" });
    trace(TAG, "sent WSL toast");
  } else {
    execSync(`osascript -e 'display notification "${msg}" with title "Claude Code"'`, { stdio: "ignore" });
    trace(TAG, "sent macOS notification");
  }
} catch (e) {
  trace(TAG, `notification failed: ${(e as Error).message?.slice(0, 100)}, falling back to bell`);
  process.stderr.write("\x07");
}

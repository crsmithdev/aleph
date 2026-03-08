#!/bin/bash
INPUT=$(cat)
EVENT=$(echo "$INPUT" | python3 -c "
import sys,json
try: d=json.load(sys.stdin); print(d.get('type','unknown'))
except: print('unknown')
" 2>/dev/null)

MSG="Claude Code needs your attention"
case "$EVENT" in
  idle)       MSG="Claude is waiting for input" ;;
  permission) MSG="Claude needs permission to proceed" ;;
  complete)   MSG="Claude finished the task" ;;
esac

if grep -qi microsoft /proc/version 2>/dev/null; then
  powershell.exe -Command "
    \$xml='<toast><visual><binding template=\"ToastText01\"><text id=\"1\">${MSG}</text></binding></visual></toast>'
    \$doc=[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]::new()
    \$doc.LoadXml(\$xml)
    \$t=[Windows.UI.Notifications.ToastNotification,Windows.UI.Notifications,ContentType=WindowsRuntime]::new(\$doc)
    [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]::CreateToastNotifier('Claude Code').Show(\$t)
  " 2>/dev/null &
elif command -v osascript &>/dev/null; then
  osascript -e "display notification \"${MSG}\" with title \"Claude Code\"" &
else
  printf '\a'
fi
exit 0

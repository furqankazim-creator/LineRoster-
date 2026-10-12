#!/bin/bash
# -------------------------------------------------------------
# ShiftLine 1-Click Presentation Launcher (macOS)
# Double-click this file to launch ShiftLine and open in browser.
# -------------------------------------------------------------

cd "$(dirname "$0")"

echo "=========================================================="
echo " Starting ShiftLine Workforce Roster System..."
echo "=========================================================="
echo ""
echo "Opening web application at: http://localhost:5173"
echo "Press Ctrl+C in this terminal window to stop the server."
echo ""

npm run dev


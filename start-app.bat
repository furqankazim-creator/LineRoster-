@echo off
REM -------------------------------------------------------------
REM ShiftLine 1-Click Presentation Launcher (Windows)
REM Double-click this file to launch ShiftLine and open in browser.
REM -------------------------------------------------------------

cd /d "%~dp0"

echo ==========================================================
echo  Starting ShiftLine Workforce Roster System...
echo ==========================================================
echo.
echo Opening web application at: http://localhost:5173
echo Press Ctrl+C to stop the server when finished.
echo.

npm run dev


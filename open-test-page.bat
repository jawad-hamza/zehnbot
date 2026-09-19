@echo off
rem Opens test.html the way a browser needs it: served from http://localhost, not as a file.
rem
rem Double-clicking test.html opens it as file://..., and browsers then send the origin "null".
rem The chat server refuses that origin on purpose (any website could fake it), so the widget
rem would never appear. Served from localhost it works, and localhost is always allowed.
rem
rem Usage: double-click this file. Close this window to stop the little web server.

cd /d "%~dp0"
set PORT=5500

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/ or use the
  echo "Preview" button in the dashboard instead, which needs nothing installed.
  pause
  exit /b 1
)

echo Serving this folder at http://localhost:%PORT%/  ^(close this window to stop^)
start "" "http://localhost:%PORT%/test.html"
python -m http.server %PORT% --bind 127.0.0.1

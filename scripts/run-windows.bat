@echo off
REM SOP Opera — start on Windows
REM Double-click this file, or run:  scripts\run-windows.bat
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-windows.ps1"
if errorlevel 1 pause

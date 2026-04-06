@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*
endlocal

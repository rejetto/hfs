:: Experimental - The idea is to distribute this bat file to run HFS on Windows as an alternative to the binary version
@echo off
setlocal EnableExtensions
node -v >nul 2>&1
if errorlevel 1 (
  echo Node.js not found in PATH. Installing with winget...
  winget install OpenJS.NodeJS -e --scope machine --version 22.*
  echo Installation finished. Please close this terminal then run this script again.
  pause
  exit /b 1
)
echo Starting HFS...
@move /y hfs.exe hfs1.exe
set UV_THREADPOOL_SIZE=32 && npx -y hfs@latest --cwd . %*
@move /y hfs1.exe hfs.exe
pause
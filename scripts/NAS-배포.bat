@echo off
setlocal
echo [NAS] saenggibu deploy via "ssh nas"
ssh nas "cd /volume1/docker/saenggibu && sh scripts/nas-docker-update.sh %*"
set "ERR=%ERRORLEVEL%"
if %ERR% neq 0 echo [FAILED] exit code %ERR%
pause
endlocal & exit /b %ERR%

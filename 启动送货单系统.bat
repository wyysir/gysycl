@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "npm_config_cache=%~dp0.npm-cache"
call npm.cmd run dev
if errorlevel 1 pause

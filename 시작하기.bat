@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요.
  start https://nodejs.org
  pause
  exit /b
)
if not exist node_modules (
  echo 처음 한 번만 필요한 파일을 설치합니다. 잠시 기다려 주세요...
  call npm install
)
start "" /b cmd /c "npm start"

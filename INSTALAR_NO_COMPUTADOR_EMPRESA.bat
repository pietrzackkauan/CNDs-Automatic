@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Instalador Completo - Sistema CND Automatico

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

:: Garante IPv4 prioritario e timeout maior para evitar travamento de download no Windows
set "NODE_OPTIONS=--dns-result-order=ipv4first"
set "PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=300000"
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"

echo ========================================================
echo   CONFIGURANDO O SISTEMA CND NESTE COMPUTADOR
echo ========================================================
echo.

echo [1/4] Criando atalhos na Area de Trabalho deste computador...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$WshShell = New-Object -ComObject WScript.Shell; " ^
  "$Desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$s1 = $WshShell.CreateShortcut((Join-Path $Desktop 'Iniciar Sistema CND.lnk')); " ^
  "$s1.TargetPath = '%ROOT_DIR%\INICIAR_SISTEMA_CND.bat'; " ^
  "$s1.WorkingDirectory = '%ROOT_DIR%'; " ^
  "$s1.Description = 'Inicia o Robo Emissor e abre o Painel de CNDs'; " ^
  "$s1.Save(); " ^
  "$s2 = $WshShell.CreateShortcut((Join-Path $Desktop 'Iniciar Chrome CND.lnk')); " ^
  "$s2.TargetPath = '%ROOT_DIR%\iniciar-chrome-cnd.bat'; " ^
  "$s2.WorkingDirectory = '%ROOT_DIR%'; " ^
  "$s2.Description = 'Abre o Chrome conectado na porta 9222 para Receita Federal e Prefeituras com Certificado'; " ^
  "$s2.Save();"
echo [OK] Atalhos criados na Area de Trabalho!
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [2/4] Node.js nao encontrado. Baixando instalador oficial do Node.js LTS...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$msi = Join-Path $env:TEMP 'nodejs_lts.msi'; " ^
      "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile $msi; " ^
      "Start-Process msiexec.exe -ArgumentList '/i', $msi, '/passive', '/norestart' -Wait"
    set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
) else (
    echo [2/4] Node.js ja esta instalado neste computador.
)
echo.

echo [3/4] Verificando dependencias...
if not exist "%ROOT_DIR%\node_modules" (
    cd /d "%ROOT_DIR%"
    call npm install
)
if not exist "%ROOT_DIR%\worker\node_modules" (
    cd /d "%ROOT_DIR%\worker"
    call npm install
)
echo [OK] Dependencias prontas!
echo.

echo [4/4] Instalando navegador automatico do Robo (Playwright Chromium)...
cd /d "%ROOT_DIR%\worker"
call npx playwright install chromium

echo.
echo ========================================================
echo   [SUCESSO] Computador configurado e pronto para uso!
echo   Os 2 atalhos ja estao na Area de Trabalho:
echo     1. Iniciar Sistema CND
echo     2. Iniciar Chrome CND
echo ========================================================
echo.
pause

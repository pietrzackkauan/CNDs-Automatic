@echo off
chcp 65001 >nul
setlocal
title Instalador - Sistema CND Automatico

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

echo ========================================================
echo   CONFIGURANDO O SISTEMA CND NESTE COMPUTADOR
echo ========================================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] O Node.js nao foi encontrado neste computador!
    echo Por favor, baixe e instale o Node.js LTS em: https://nodejs.org/
    echo Depois de instalar o Node.js, execute este arquivo novamente.
    pause
    exit /b 1
)

echo [1/4] Instalando dependencias do Painel...
cd /d "%ROOT_DIR%"
call npm install

echo.
echo [2/4] Instalando dependencias do Robo (Worker)...
cd /d "%ROOT_DIR%\worker"
call npm install

echo.
echo [3/4] Instalando navegador automatico do Robo (Playwright Chromium)...
call npx playwright install chromium

echo.
echo [4/4] Criando atalhos na Area de Trabalho deste computador...
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

echo.
echo ========================================================
echo   [SUCESSO] Computador configurado e pronto para uso!
echo   Dois atalhos foram criados na Area de Trabalho:
echo     1. Iniciar Sistema CND
echo     2. Iniciar Chrome CND
echo ========================================================
echo.
pause

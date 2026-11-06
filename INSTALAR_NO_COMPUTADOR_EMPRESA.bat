@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Instalador Completo - Sistema CND Automatico

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

echo ========================================================
echo   CONFIGURANDO O SISTEMA CND NESTE COMPUTADOR
echo ========================================================
echo.

:: Garante que a pasta padrao do Node.js esteja no PATH desta sessao
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [0/4] Node.js nao encontrado. Instalando Node.js LTS automaticamente...
    
    where winget >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo Baixando e instalando Node.js LTS via Winget...
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    ) else (
        echo Baixando instalador oficial do Node.js LTS...
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "$msi = Join-Path $env:TEMP 'nodejs_lts.msi'; " ^
          "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile $msi; " ^
          "Start-Process msiexec.exe -ArgumentList '/i', $msi, '/passive', '/norestart' -Wait"
    )

    set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"

    where node >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo [ERRO] Nao foi possivel concluir a instalacao automatica do Node.js.
        echo Clique com o botao direito neste arquivo e escolha "Executar como Administrador".
        pause
        exit /b 1
    )
    echo [OK] Node.js instalado com sucesso!
    echo.
) else (
    echo [0/4] Node.js ja esta instalado neste computador.
    echo.
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

@echo off
chcp 65001 >nul
setlocal
title Central CND - Iniciando Sistema

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

echo ========================================================
echo      INICIANDO SISTEMA AUTOMATICO DE CNDs
echo ========================================================
echo.

echo [1/3] Iniciando o Robô Emissor de CNDs (Worker)...
start "Robo Emissor CND (MANTENHA ABERTO)" cmd /k "cd /d "%ROOT_DIR%\worker" && npx tsx src/index.ts"

echo [2/3] Iniciando o Painel Web Local...
start "Painel Web CND (MANTENHA ABERTO)" cmd /k "cd /d "%ROOT_DIR%" && npm run dev -- --port 5173 --host"

echo [3/3] Aguardando 4 segundos para abrir o painel no navegador...
timeout /t 4 /nobreak >nul

start "" "https://cnd-automatic.vercel.app"
start "" "http://localhost:5173"

echo.
echo ========================================================
echo   [SUCESSO] Sistema iniciado!
echo   - Site Oficial (Vercel): https://cnd-automatic.vercel.app
echo   - Painel Local:          http://localhost:5173
echo   - Mantenha a janela "Robo Emissor CND" aberta para processar as filas.
echo ========================================================
timeout /t 4 >nul
exit

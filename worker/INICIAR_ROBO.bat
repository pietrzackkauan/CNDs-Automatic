@echo off
title Robô de CNDs Automáticas - Integrados Soluções
color 0A

echo ======================================================
echo    INICIANDO ROBO DE EMISSAO DE CNDS (INTEGRADOS)
echo ======================================================
echo.
echo Conectando a fila de tarefas no Supabase...
echo Aguardando lotes enviados pelo sistema Web (Vercel)...
echo.

cd /d "%~dp0"
npx tsx src/index.ts

pause

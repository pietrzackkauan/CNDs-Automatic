@echo off
setlocal
title Iniciar Chrome CND - Modo Conectado

echo ========================================================
echo   CND-Anty - Iniciando Google Chrome em Modo Conectado
echo ========================================================
echo.

set PROFILE_DIR=%LOCALAPPDATA%\CND-Anty\ChromeProfile
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%"

echo Verificando e liberando sessoes anteriores do perfil CND...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | Where-Object { $_.CommandLine -like '*CND-Anty*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

ping 127.0.0.1 -n 2 >nul

set CHROME_BIN=C:\Program Files\Google\Chrome\Application\chrome.exe
if not exist "%CHROME_BIN%" set CHROME_BIN=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
if not exist "%CHROME_BIN%" set CHROME_BIN=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe

echo Abrindo o Google Chrome na sua tela...
start "" "%CHROME_BIN%" --remote-debugging-port=9222 --user-data-dir="%PROFILE_DIR%" --no-first-run --no-default-browser-check ^
  "https://cav.receita.fazenda.gov.br/ecac" ^
  "https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj" ^
  "https://servicos.prefeituradearuja.sp.gov.br/tbw/loginCNPJContribuinte.jsp?execobj=ContribuintesWebRelacionados" ^
  "https://ws.linhares.es.gov.br/services/certidao_retirada.php" ^
  "https://servicos.cloud.el.com.br/es-saomateus-pm/services/certidao_retirada.php" ^
  "https://duc.prefeitura.sp.gov.br/certidoes/forms_anonimo/frmConsultaEmissaoCertidao.aspx"

ping 127.0.0.1 -n 4 >nul

curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto aviso

echo.
echo ========================================================
echo   [SUCESSO] Google Chrome conectado na porta 9222!
echo ========================================================
echo.
echo - Passo 1: Na janela do Chrome que abriu, faca login com seu Certificado Digital.
echo - Passo 2: Pronto! Mantenha o Chrome aberto no computador.
echo - Passo 3: Acesse http://localhost:5173 para emitir as certidoes.
goto fim

:aviso
echo.
echo [AVISO] Chrome iniciando. Verifique a janela aberta na sua barra de tarefas.

:fim
echo.
echo Pressione qualquer tecla para fechar esta janela...
pause >nul

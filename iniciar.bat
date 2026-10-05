@echo off
chcp 65001 > nul
title JuCut — Editor de Vídeo de Alta Performance
color 0b

echo ========================================================
echo         JuCut — Servidor Local de Alta Performance
echo ========================================================
echo.
echo  [*] Verificando Python e FFmpeg...
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Python nao foi encontrado no sistema!
    echo Baixe o Python em python.org ou use a versao web no GitHub Pages.
    pause
    exit /b 1
)

echo  [*] Iniciando servidor local na porta 8765...
start "" "http://localhost:8765"
python server.py

pause

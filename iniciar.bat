@echo off
REM Levanta el Mapa Vivo: servidor + sincronizacion del sheet + pantalla completa.
REM Para cerrar la pantalla: Alt+F4. Para detener el servidor: cerrar la ventana "Mapa Vivo - servidor".
cd /d "%~dp0"

start "Mapa Vivo - servidor" /min python servidor.py

REM esperar a que el servidor y la primera sincronizacion arranquen
timeout /t 5 /nobreak >nul

set "URL=http://127.0.0.1:8765/"
set "PERFIL=%LOCALAPPDATA%\MapaVivo\navegador"

REM Perfil propio para que el modo kiosco funcione aunque Chrome ya este abierto
start "" chrome --kiosk --user-data-dir="%PERFIL%" --no-first-run --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required "%URL%" 2>nul
if errorlevel 1 start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen --user-data-dir="%PERFIL%" --no-first-run

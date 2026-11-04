
@echo off
setlocal
set "PROJECT_DIR=%~dp0"

if not exist "%PROJECT_DIR%backend\.venv\Scripts\python.exe" (
  echo Backend Python environment was not found.
  echo Open the project README to set up the backend first.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%frontend\node_modules" (
  echo Frontend dependencies were not found.
  echo Open the frontend folder and run npm install first.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', 8003); exit 0 } catch { exit 1 } finally { $client.Dispose() }"
if errorlevel 1 (
  start "Mkulima Connect API" /D "%PROJECT_DIR%backend" "%PROJECT_DIR%backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8003
)

powershell -NoProfile -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', 5173); exit 0 } catch { exit 1 } finally { $client.Dispose() }"
if errorlevel 1 (
  start "Mkulima Connect Web" /D "%PROJECT_DIR%frontend" cmd /k npm.cmd run dev -- --host 127.0.0.1
)

echo Waiting for Mkulima Connect to start...
powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(45); $apiReady = $false; do { try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8003/api/products' -TimeoutSec 2; if ($response.StatusCode -eq 200) { $apiReady = $true; break } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); if (-not $apiReady) { exit 1 }; $deadline = (Get-Date).AddSeconds(45); $webReady = $false; do { try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; if ($response.StatusCode -eq 200) { $webReady = $true; break } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); if ($webReady) { exit 0 }; exit 1"
if errorlevel 1 (
  echo The web app did not become ready. Check the Mkulima Connect terminal windows.
  exit /b 1
)
start "" "http://localhost:5173"

@echo off
REM 一键启动独立 Edge 调试实例（不与 WorkBuddy Edge 冲突）
REM 启动后 Edge 监听到 9222 端口，Claude 可以接管

set EDGE_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set DEBUG_DIR=%TEMP%\videomind-edge-debug
set CDP_PORT=9222

REM 创建隔离的 user-data-dir（不影响现有 Edge）
if not exist "%DEBUG_DIR%" (
  mkdir "%DEBUG_DIR%"
)

echo ====================================
echo 启动调试用 Edge
echo 端口: %CDP_PORT%
echo 数据目录: %DEBUG_DIR%
echo ====================================
echo.
echo 启动后请：
echo   1. 登录抖音 (扫码)
echo   2. 进入收藏夹页面
echo   3. 不要关闭此窗口
echo.

start "" %EDGE_PATH% ^
  --remote-debugging-port=%CDP_PORT% ^
  --remote-allow-origins=* ^
  --user-data-dir="%DEBUG_DIR%" ^
  --no-first-run ^
  --no-default-browser-check

echo Edge 已启动 (PID 见任务管理器)
echo 验证: curl http://localhost:%CDP_PORT%/json/version
pause
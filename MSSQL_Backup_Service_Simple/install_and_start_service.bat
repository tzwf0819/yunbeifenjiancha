@echo off
:: ============================================================================
:: 自动请求管理员权限 (UAC) - 可靠版
:: ============================================================================
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul
    exit /b
)

:: ============================================================================
:: 主脚本开始
:: ============================================================================

REM --- 设置控制台编码为 UTF-8 以正确显示中文字符 ---
chcp 65001 > nul

setlocal

REM --- 切换到脚本所在目录 ---
cd /d "%~dp0"

echo =========================================================
echo       开始部署 MSSQL 定时备份服务
echo =========================================================
echo.

echo --- 步骤 1/5: 检查 Python 环境 ---
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误：未在系统中找到 Python 环境。
    echo 请先安装 Python 3，并确保已将其添加到系统 PATH 环境变量中。
    pause
    exit /b
)
echo Python 环境已找到。
echo.


echo --- 步骤 2/5: 停止并卸载旧服务 (如果存在) ---
echo 正在尝试停止旧服务(MSSQLScheduledBackupSvc)... (如果不存在，此步报错可忽略)
sc stop MSSQLScheduledBackupSvc >nul 2>&1
echo.
echo 正在尝试移除旧服务... (如果不存在，此步报错可忽略)
python windows_service.py remove >nul 2>&1
echo 旧服务清理完毕。
echo.


echo --- 步骤 3/5: 安装依赖并自动配置 pywin32 ---
echo.
echo [1/3] 正在从 requirements.txt 安装依赖...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo 警告：从 requirements.txt 安装依赖时出现问题，但脚本将继续。
)
echo.

echo [2/3] 正在确保 pywin32 已正确安装...
pip install --upgrade pywin32
if %errorlevel% neq 0 (
    echo.
    echo 错误：安装 pywin32 失败。请检查您的网络和 Python 环境。
    pause
    exit /b
)
echo.

echo [3/3] 正在自动运行 pywin32 安装后修复程序...
set "PYTHON_SCRIPTS_PATH="
for /f "delims=" %%i in ('where python') do (
    if not defined PYTHON_SCRIPTS_PATH (
        for %%j in ("%%i") do (
            set "PYTHON_SCRIPTS_PATH=%%~dpjScripts"
        )
    )
)

if not defined PYTHON_SCRIPTS_PATH (
    echo 错误：无法定位到 Python 的 Scripts 目录。自动配置失败。
    pause
    exit /b
)

if not exist "%PYTHON_SCRIPTS_PATH%\pywin32_postinstall.py" (
    echo 错误：在 "%PYTHON_SCRIPTS_PATH%" 中找不到 pywin32_postinstall.py。
    echo 无法自动完成配置。
    pause
    exit /b
)

python "%PYTHON_SCRIPTS_PATH%\pywin32_postinstall.py" -install >nul
if %errorlevel% neq 0 (
    echo 警告：pywin32 配置脚本执行失败。服务安装可能仍会失败。
    pause
) else (
    echo pywin32 配置成功！
)
echo.


echo --- 步骤 4/5: 安装 Windows 服务 ---
echo 正在将脚本注册为 Windows 服务 (MSSQLScheduledBackupSvc)...

python windows_service.py install

if %errorlevel% neq 0 (
    echo 错误：安装 Windows 服务失败。
    echo 请检查以上错误信息，或尝试手动运行 `python windows_service.py install`。
    pause
    exit /b
) else (
    echo Windows 服务安装成功！
)
echo.


echo --- 步骤 5/5: 启动 Windows 服务 ---
echo 正在启动服务...

python windows_service.py start

if %errorlevel% neq 0 (
    echo 错误：启动 Windows 服务失败。
    echo 您可以稍后在 Windows 服务管理器 (services.msc) 中手动启动 "MSSQL定时备份服务"。
    pause
    exit /b
) else (
    echo Windows 服务已成功启动！
)
echo.


echo =========================================================
echo         服务部署完成！
echo =========================================================
echo.
echo 服务 "MSSQL定时备份服务" 已在后台运行。
echo 它将根据您在 `settings.ini` 中配置的 `task_id`，自动从服务器获取备份计划并执行。

echo.
echo 您可以随时在 Windows 服务管理器 (运行 services.msc) 中查看、停止或重启该服务。
echo.
pause

endlocal

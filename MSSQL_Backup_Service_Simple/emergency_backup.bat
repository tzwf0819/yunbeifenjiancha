@echo off
REM 紧急备份脚本 - 立即执行所有启用数据库的备份
chcp 65001 > nul
echo =====================================================
echo           MSSQL数据库紧急备份工具
echo =====================================================
echo.

REM 显示当前时间
echo 开始时间: %date% %time%
echo.

REM 检查Python是否可用
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误：Python未安装或不在PATH中！
    echo 请先安装Python或检查环境变量设置。
    pause
    exit /b 1
)

REM 检查配置文件是否存在
if not exist "config.ini" (
    echo 错误：找不到配置文件 config.ini！
    echo 请确保在正确的项目目录中运行此脚本。
    pause
    exit /b 1
)

REM 检查备份服务文件是否存在
if not exist "backup_service.py" (
    echo 错误：找不到备份服务文件 backup_service.py！
    echo 请确保所有必要文件都在当前目录中。
    pause
    exit /b 1
)

echo 正在执行紧急备份，请稍等...
echo.
echo =====================================================

REM 执行紧急备份
python backup_service.py --emergency

REM 获取执行结果
if %errorlevel% equ 0 (
    echo.
    echo =====================================================
    echo ✓ 紧急备份执行成功！
    echo.
    echo 备份文件位置: backups\ 目录
    echo 日志文件: backup_service.log
    echo.
) else (
    echo.
    echo =====================================================
    echo ✗ 紧急备份执行失败！
    echo.
    echo 请检查以下项目：
    echo 1. 数据库连接配置是否正确
    echo 2. SQL Server服务是否正在运行
    echo 3. sqlcmd工具是否已安装
    echo 4. 华为云OBS配置是否正确
    echo 5. 网络连接是否正常    echo.
    echo 详细错误信息请查看 backup_service.log 文件
    echo.
)

echo 结束时间: %date% %time%
echo =====================================================

REM 询问是否查看日志
set /p viewlog="是否查看备份日志？[Y/N]: "
if /i "%viewlog%"=="Y" (
    if exist "backup_service.log" (
        echo.
        echo 最近的日志内容：
        echo =====================================================
        powershell -command "Get-Content 'backup_service.log' | Select-Object -Last 20"
    ) else (
        echo 日志文件不存在。
    )
)

echo.
echo 按任意键退出...
pause > nul
@echo off
REM MSSQL数据库备份服务安装脚本
chcp 65001 > nul
echo =====================================================
echo      MSSQL数据库备份服务安装程序
echo =====================================================
echo.

REM 检查是否以管理员权限运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误：请以管理员身份运行此脚本！
    pause
    exit /b 1
)

REM 检查Python是否已安装
python --version >nul 2>&1
if errorlevel 1 (
    echo Python未安装。正在安装Python...
    if exist "python-3.13.7-amd64.exe" (
        echo 开始安装Python，请稍等...
        start /wait python-3.13.7-amd64.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
        echo Python安装完成！
    ) else (
        echo 找不到Python安装文件，请手动安装Python 3.8+
        pause
        exit /b 1
    )
) else (
    echo Python已安装
)

echo.
echo 正在安装Python依赖包...
pip install -r requirements_simple.txt

echo.
echo 正在安装Windows服务...
python windows_service.py install

echo.
echo 正在设置服务为自动启动...
sc config MSSQLBackupService start= auto

echo.
echo 正在启动服务...
python windows_service.py start

echo.
echo =====================================================
echo 安装完成！
echo.
echo 服务名称: MSSQLBackupService
echo 显示名称: MSSQL数据库备份服务
echo 服务状态: 自动启动
echo.
echo 管理命令:
echo   启动服务: python windows_service.py start
echo   停止服务: python windows_service.py stop
echo   卸载服务: python windows_service.py remove
echo   紧急备份: python backup_service.py --emergency
echo.
echo 请确保配置文件 config.ini 已正确设置！
echo =====================================================
pause
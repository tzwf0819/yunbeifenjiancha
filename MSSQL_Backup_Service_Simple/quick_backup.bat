@echo off
REM 快速紧急备份 - 无需确认，直接执行
chcp 65001 > nul

echo [%time%] 开始紧急备份...

REM 直接调用Python备份脚本
python backup_service.py --emergency

if %errorlevel% equ 0 (
    echo [%time%] ✓ 紧急备份完成！
) else (
    echo [%time%] ✗ 紧急备份失败！
    echo 请查看 backup_service.log 了解详细错误信息
)

REM 自动退出，不等待用户输入
exit /b %errorlevel%
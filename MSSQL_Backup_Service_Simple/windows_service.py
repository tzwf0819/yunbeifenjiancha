#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Windows服务包装器 - 用于将数据库备份服务注册为Windows服务
"""

import win32serviceutil
import win32service
import win32event
import servicemanager
import sys
import os
import time
from datetime import datetime

# 添加当前目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from backup_service import DatabaseBackupService
except ImportError as e:
    print(f"导入错误: {e}")
    print("请先安装依赖包: pip install pywin32")
    raise

class MSSQLBackupService(win32serviceutil.ServiceFramework):
    """MSSQL数据库备份服务"""
    
    _svc_name_ = "MSSQLBackupService"
    _svc_display_name_ = "MSSQL数据库备份服务"
    _svc_description_ = "自动执行MSSQL数据库备份并上传至华为云OBS存储"
    _svc_start_type_ = win32service.SERVICE_AUTO_START  # 自动启动
    
    def __init__(self, args):
        # 处理Windows服务框架传递的空参数列表
        if not args:
            args = ['']
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.hWaitStop = win32event.CreateEvent(None, 0, 0, None)
        self.service = None
        
    def SvcStop(self):
        """停止服务"""
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        servicemanager.LogInfoMsg("正在停止数据库备份服务...")
        
        if self.service:
            self.service.stop_service()
        
        win32event.SetEvent(self.hWaitStop)
        
    def SvcDoRun(self):
        """运行服务主逻辑"""
        servicemanager.LogMsg(servicemanager.EVENTLOG_INFORMATION_TYPE,
                             servicemanager.PYS_SERVICE_STARTED,
                             (self._svc_name_, ''))
        
        # 报告服务运行状态
        self.ReportServiceStatus(win32service.SERVICE_RUNNING)
        
        try:
            # 切换到脚本目录确保能找到config.ini
            script_dir = os.path.dirname(os.path.abspath(__file__))
            os.chdir(script_dir)
            
            servicemanager.LogInfoMsg(f"服务工作目录: {os.getcwd()}")
            
            # 检查配置文件是否存在
            settings_path = os.path.join(script_dir, 'settings.ini')
            if not os.path.exists(settings_path):
                servicemanager.LogErrorMsg(f"找不到API配置文件: {settings_path}")
                return
            
            # 初始化备份服务
            servicemanager.LogInfoMsg("初始化数据库备份服务（云端模式）...")
            self.service = DatabaseBackupService(settings_path)
            servicemanager.LogInfoMsg("数据库备份服务初始化成功")
            
            # 主服务循环
            iteration_count = 0
            while True:
                # 检查是否应该停止服务
                if win32event.WaitForSingleObject(self.hWaitStop, 1000) == win32event.WAIT_OBJECT_0:
                    servicemanager.LogInfoMsg("收到停止信号，正在关闭服务...")
                    break
                
                iteration_count += 1
                
                try:
                    # 每小时记录一次状态
                    if iteration_count % 60 == 0:
                        servicemanager.LogInfoMsg(f"服务正在运行，迭代 {iteration_count}")
                    
                    # 执行一次服务迭代
                    self.service.run_service_iteration()
                    
                except Exception as e:
                    servicemanager.LogErrorMsg(f"服务迭代错误: {e}")
                    # 出错后等待60秒继续
                    time.sleep(60)
                
                # 等待60秒进行下次检查
                time.sleep(60)
            
        except Exception as e:
            servicemanager.LogErrorMsg(f"服务致命错误: {e}")
            
        finally:
            # 报告服务已停止
            self.ReportServiceStatus(win32service.SERVICE_STOPPED)
            servicemanager.LogInfoMsg("数据库备份服务已停止")

def main():
    """主函数 - 处理命令行参数"""
    if len(sys.argv) == 1:
        # 作为服务运行
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(MSSQLBackupService)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        # 处理命令行参数 (install, start, stop, remove等)
        win32serviceutil.HandleCommandLine(MSSQLBackupService)

if __name__ == '__main__':
    main()
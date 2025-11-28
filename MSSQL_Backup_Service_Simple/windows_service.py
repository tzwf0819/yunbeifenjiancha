
import win32serviceutil
import win32service
import win32event
import servicemanager
import sys
import os
import time
import configparser
from datetime import datetime

# 添加当前目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from backup_service import BackupTaskRunner
except ImportError as e:
    servicemanager.LogErrorMsg(f"导入错误: {e}")
    raise

class MSSQLScheduledBackupSvc(win32serviceutil.ServiceFramework):
    """MSSQL数据库定时备份服务"""
    
    _svc_name_ = "MSSQLScheduledBackupSvc"
    _svc_display_name_ = "MSSQL定时备份服务"
    _svc_description_ = "根据云端配置，为指定任务执行数据库备份和上传。"
    _svc_start_type_ = win32service.SERVICE_AUTO_START
    
    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.hWaitStop = win32event.CreateEvent(None, 0, 0, None)
        self.running = False
        self.runner = None

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        servicemanager.LogInfoMsg("正在停止定时备份服务...")
        self.running = False
        win32event.SetEvent(self.hWaitStop)
        
    def SvcDoRun(self):
        self.running = True
        # 马上报告服务正在运行，满足服务管理器30秒的启动时限
        self.ReportServiceStatus(win32service.SERVICE_RUNNING)
        servicemanager.LogMsg(servicemanager.EVENTLOG_INFORMATION_TYPE,
                             servicemanager.PYS_SERVICE_STARTED,
                             (self._svc_name_, ''))
        
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            os.chdir(script_dir)
            
            task_id = self.load_task_id_from_settings(script_dir)
            if not task_id:
                servicemanager.LogErrorMsg("错误: 无法从settings.ini加载task_id，服务即将停止。")
                self.SvcStop()
                return

            self.runner = BackupTaskRunner(task_id)
            servicemanager.LogInfoMsg(f"服务已初始化，开始监控任务ID: {task_id}")

            check_interval_ms = 15 * 1000 # 15秒检查一次
            heartbeat_interval_cycles = 20 # 每20个周期记录一次心跳日志 (20 * 15秒 = 5分钟)
            cycle_count = 0

            # 服务主循环
            while self.running:
                # 调用一次检查与执行的逻辑
                self.runner.check_and_execute()
                
                cycle_count += 1
                if cycle_count >= heartbeat_interval_cycles:
                    servicemanager.LogInfoMsg(f"服务心跳：服务正在运行并持续监控任务 {task_id}。")
                    cycle_count = 0 # 重置计数器

                # 使用事件等待，这样服务可以立即响应停止信号，而不是被sleep阻塞
                wait_result = win32event.WaitForSingleObject(self.hWaitStop, check_interval_ms)
                
                # 如果收到停止信号，就跳出循环
                if wait_result == win32event.WAIT_OBJECT_0:
                    break

        except Exception as e:
            servicemanager.LogErrorMsg(f"服务主循环中发生致命错误: {e}")
            self.SvcStop() # 发生未知严重错误时，尝试停止服务
        finally:
            # 确保服务退出时状态被正确报告
            self.ReportServiceStatus(win32service.SERVICE_STOPPED)
            servicemanager.LogInfoMsg(f"{self._svc_name_} 已停止。")

    def load_task_id_from_settings(self, script_dir):
        try:
            settings_path = os.path.join(script_dir, 'settings.ini')
            if not os.path.exists(settings_path):
                return None
            config = configparser.ConfigParser()
            config.read(settings_path, encoding='utf-8')
            return config.get('BACKUP_CLIENT', 'task_id', fallback=None)
        except Exception as e:
            servicemanager.LogErrorMsg(f"读取 task_id 出错: {e}")
            return None

def main():
    if len(sys.argv) == 1:
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(MSSQLScheduledBackupSvc)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        win32serviceutil.HandleCommandLine(MSSQLScheduledBackupSvc)

if __name__ == '__main__':
    main()

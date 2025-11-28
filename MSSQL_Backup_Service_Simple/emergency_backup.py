
import os
import sys

# 确保可以从当前目录导入 backup_service
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from backup_service import do_backup
except ImportError as e:
    print(f"错误: 无法导入备份服务模块 - {e}")
    print("请确保 backup_service.py 文件在当前目录中")
    sys.exit(1)

def trigger_emergency_backup(task_id):
    """为指定的任务ID触发紧急备份"""
    print(f"收到紧急备份请求，任务ID: {task_id}")
    print("正在调用核心备份服务...")
    
    try:
        do_backup(task_id, "EMERGENCY")
        print(f"任务 {task_id} 的紧急备份流程已启动。")
        print("详细日志请查看 logs/ 目录下的对应日志文件。")
    except Exception as e:
        print(f"执行紧急备份时发生致命错误: {e}")
        sys.exit(1)

def main():
    """脚本主入口"""
    if len(sys.argv) != 2:
        print("用法: python emergency_backup.py <task_id>")
        print("错误: 请提供需要执行紧急备份的任务ID。")
        sys.exit(1)
        
    task_id = sys.argv[1]
    trigger_emergency_backup(task_id)

if __name__ == "__main__":
    main()

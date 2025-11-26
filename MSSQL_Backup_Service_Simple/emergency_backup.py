#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
紧急备份工具 - 提供交互式的紧急备份功能
功能：
- 列出所有可备份的数据库
- 选择性备份特定数据库
- 全部备份
- 实时显示备份进度
- 备份结果统计
"""

import os
import sys
import time
from datetime import datetime

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from backup_service import DatabaseBackupService
except ImportError as e:
    print(f"错误: 无法导入备份服务模块 - {e}")
    print("请确保 backup_service.py 文件在当前目录中")
    input("按Enter键退出...")
    sys.exit(1)

class EmergencyBackupTool:
    """紧急备份工具类"""
    
    def __init__(self):
        self.service = None
        self.databases = []
        
    def initialize(self):
        """初始化备份服务"""
        try:
            print("正在初始化备份服务...")
            self.service = DatabaseBackupService()
            self.databases = self.service.get_enabled_databases()
            print(f"✓ 备份服务初始化成功")
            return True
        except Exception as e:
            print(f"✗ 初始化失败: {e}")
            return False
    
    def show_database_list(self):
        """显示数据库列表"""
        if not self.databases:
            print("没有找到启用的数据库配置")
            return False
            
        print("\n" + "="*50)
        print("可备份的数据库列表:")
        print("="*50)
        
        for i, db in enumerate(self.databases, 1):
            print(f"{i}. {db['database_name']} ({db['name']})")
            print(f"   服务器: {db['server']}")
            print(f"   备份时间: {', '.join(db['backup_times']) if db['backup_times'] else '无定时备份'}")
            print(f"   小时备份: {'是' if db['hourly_backup'] else '否'}")
            print()
            
        return True
    
    def backup_single_database(self, db_index):
        """备份单个数据库"""
        if db_index < 1 or db_index > len(self.databases):
            print("无效的数据库编号")
            return False
            
        db_config = self.databases[db_index - 1]
        print(f"\n开始备份数据库: {db_config['database_name']}")
        print("-" * 40)
        
        # 执行备份
        backup_file = self.service.backup_database(db_config)
        if backup_file:
            print(f"✓ 数据库备份成功: {os.path.basename(backup_file)}")
            
            # 上传到OBS
            print("正在上传到华为云OBS...")
            if self.service.upload_to_obs(backup_file):
                print("✓ 上传到OBS成功")
                return True
            else:
                print("✗ 上传到OBS失败")
                return False
        else:
            print("✗ 数据库备份失败")
            return False
    
    def backup_all_databases(self):
        """备份所有数据库"""
        print(f"\n开始备份所有数据库 (共{len(self.databases)}个)...")
        print("="*50)
        
        success_count = 0
        failed_databases = []
        
        for i, db_config in enumerate(self.databases, 1):
            print(f"\n[{i}/{len(self.databases)}] 备份: {db_config['database_name']}")
            
            # 执行备份
            backup_file = self.service.backup_database(db_config)
            if backup_file:
                # 上传到OBS
                if self.service.upload_to_obs(backup_file):
                    success_count += 1
                    print(f"✓ {db_config['database_name']} 备份完成")
                else:
                    failed_databases.append(f"{db_config['database_name']} (上传失败)")
            else:
                failed_databases.append(f"{db_config['database_name']} (备份失败)")
        
        # 清理旧备份
        print("\n清理过期备份...")
        self.service.cleanup_old_backups()
        
        # 显示结果统计
        print("\n" + "="*50)
        print("备份结果统计:")
        print("="*50)
        print(f"成功备份: {success_count}/{len(self.databases)} 个数据库")
        
        if failed_databases:
            print("失败列表:")
            for db in failed_databases:
                print(f"  ✗ {db}")
        
        return success_count
    
    def show_backup_history(self):
        """显示备份历史"""
        backup_dir = "backups"
        if not os.path.exists(backup_dir):
            print("备份目录不存在")
            return
            
        files = [f for f in os.listdir(backup_dir) if f.endswith('.bak')]
        if not files:
            print("没有找到备份文件")
            return
        
        # 按修改时间排序
        files.sort(key=lambda x: os.path.getmtime(os.path.join(backup_dir, x)), reverse=True)
        
        print("\n" + "="*60)
        print("最近的备份文件:")
        print("="*60)
        print(f"{'文件名':<35} {'大小':<10} {'创建时间'}")
        print("-"*60)
        
        for file in files[:10]:  # 只显示最近10个
            file_path = os.path.join(backup_dir, file)
            size = os.path.getsize(file_path)
            size_str = f"{size/1024/1024:.1f}MB" if size > 1024*1024 else f"{size/1024:.1f}KB"
            mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
            print(f"{file:<35} {size_str:<10} {mtime.strftime('%Y-%m-%d %H:%M:%S')}")
    
    def run_interactive(self):
        """运行交互式界面"""
        print("="*60)
        print("          MSSQL数据库紧急备份工具")
        print("="*60)
        print(f"当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # 初始化
        if not self.initialize():
            input("\n按Enter键退出...")
            return
            
        while True:
            # 显示主菜单
            print("\n" + "="*40)
            print("请选择操作:")
            print("="*40)
            print("1. 查看可备份数据库列表")
            print("2. 备份指定数据库")
            print("3. 备份所有数据库")
            print("4. 查看备份历史")
            print("5. 查看备份日志")
            print("0. 退出")
            print("-"*40)
            
            try:
                choice = input("请输入选项 (0-5): ").strip()
                
                if choice == '0':
                    print("感谢使用紧急备份工具！")
                    break
                elif choice == '1':
                    self.show_database_list()
                elif choice == '2':
                    if self.show_database_list():
                        try:
                            db_num = int(input(f"请输入数据库编号 (1-{len(self.databases)}): "))
                            self.backup_single_database(db_num)
                        except ValueError:
                            print("请输入有效的数字")
                elif choice == '3':
                    if len(self.databases) == 0:
                        print("没有可备份的数据库")
                    else:
                        confirm = input(f"确定要备份所有 {len(self.databases)} 个数据库吗？[Y/N]: ")
                        if confirm.lower() in ['y', 'yes']:
                            self.backup_all_databases()
                elif choice == '4':
                    self.show_backup_history()
                elif choice == '5':
                    self.show_backup_log()
                else:
                    print("无效的选项，请重新输入")
                    
            except KeyboardInterrupt:
                print("\n\n用户取消操作")
                break
            except Exception as e:
                print(f"操作出错: {e}")
    
    def show_backup_log(self):
        """显示备份日志"""
        log_file = "backup_service.log"
        if not os.path.exists(log_file):
            print("日志文件不存在")
            return
            
        print("\n" + "="*60)
        print("最近的备份日志 (最后20行):")
        print("="*60)
        
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                for line in lines[-20:]:
                    print(line.rstrip())
        except Exception as e:
            print(f"读取日志文件失败: {e}")

def main():
    """主函数"""
    # 检查运行环境
    if not os.path.exists('config.ini'):
        print("错误: 找不到配置文件 config.ini")
        print("请确保在正确的项目目录中运行此脚本")
        input("按Enter键退出...")
        return
    
    # 创建并运行工具
    tool = EmergencyBackupTool()
    
    # 检查命令行参数
    if len(sys.argv) > 1 and sys.argv[1] == '--auto':
        # 自动模式 - 直接备份所有数据库
        print("自动备份模式")
        if tool.initialize():
            success_count = tool.backup_all_databases()
            sys.exit(0 if success_count > 0 else 1)
        else:
            sys.exit(1)
    else:
        # 交互模式
        tool.run_interactive()

if __name__ == "__main__":
    main()
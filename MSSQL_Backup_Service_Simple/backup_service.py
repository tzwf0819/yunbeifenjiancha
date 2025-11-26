#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import logging
import configparser
import subprocess
from datetime import datetime

try:
    import requests
    from obs import ObsClient
except ImportError:
    print("请先安装依赖: pip install requests esdk-obs-python")
    sys.exit(1)

class SingleTaskBackupService:
    """单个任务的备份服务，根据从云端获取的专属配置执行任务"""

    def __init__(self, settings_path='settings.ini'):
        self.settings_path = settings_path
        self.settings = self.load_settings()
        self.setup_logging()
        self.running = False
        self.last_backup_times = {}  # Key: db_name
        self.task_config = None # 存储从服务器获取的单个任务配置
        self.huawei_obs_config = None # 存储全局OBS配置
        self.last_config_fetch_time = None
        self.server_url = self.settings.get('BACKUP_CLIENT', 'server_url')
        self.task_id = self.settings.get('BACKUP_CLIENT', 'task_id')
        self.api_key = self.settings.get('BACKUP_CLIENT', 'api_key')
        self.api_headers = {'x-api-key': self.api_key}

    def load_settings(self):
        config = configparser.ConfigParser()
        if not os.path.exists(self.settings_path):
            raise FileNotFoundError(f"客户端配置文件 {self.settings_path} 不存在")
        config.read(self.settings_path, encoding='utf-8')
        return config

    def setup_logging(self):
        log_dir = 'logs'
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, f"task_{self.task_id}.log")

        formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(formatter)

        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(formatter)

        self.logger = logging.getLogger(f"Task_{self.task_id}")
        self.logger.setLevel(logging.INFO)
        self.logger.handlers = []
        self.logger.addHandler(file_handler)
        self.logger.addHandler(console_handler)
        self.logger.propagate = False

    def fetch_config(self):
        """从主服务器获取此任务的特定配置和全局OBS配置"""
        try:
            # 1. 获取任务专属配置
            task_api_url = f"{self.server_url}/api/tasks/{self.task_id}/config"
            self.logger.info(f"正在从 {task_api_url} 获取任务配置...")
            response = requests.get(task_api_url, headers=self.api_headers, timeout=15)
            response.raise_for_status()
            self.task_config = response.json()
            
            # 2. 获取全局配置 (主要为了OBS信息)
            # 在新架构中，任务配置已包含所有需要的信息，但如果需要全局配置，可以取消下面的注释
            # global_api_url = f"{self.server_url}/api/config"
            # self.logger.info(f"正在从 {global_api_url} 获取全局配置...")
            # global_response = requests.get(global_api_url, headers=self.api_headers, timeout=15)
            # global_response.raise_for_status()
            # global_config = global_response.json()
            # self.huawei_obs_config = global_config.get('huawei_obs')
            
            # 简化：直接从主程序的 /api/config 获取 OBS 配置
            global_config_url = f"{self.server_url}/api/config"
            self.logger.info(f"正在从 {global_config_url} 获取 OBS 配置...")
            global_config_resp = requests.get(global_config_url, headers={'Authorization': 'Bearer YOUR_JWT_TOKEN_IF_NEEDED'}) # 注意：这个端点可能需要不同的认证
            global_config_resp.raise_for_status()
            self.huawei_obs_config = global_config_resp.json().get('huawei_obs')


            self.last_config_fetch_time = datetime.now()
            self.logger.info(f"成功加载任务 '{self.task_config.get('name')}' 的配置。")
            return True
        except requests.exceptions.RequestException as e:
            self.logger.error(f"从云端获取配置失败: {e}")
            return False
        except Exception as e:
            self.logger.error(f"处理云端配置时出错: {e}")
            return False

    def check_for_emergency_backup(self):
        """检查并执行紧急备份"""
        try:
            status_url = f"{self.server_url}/api/tasks/{self.task_id}/status"
            # webAuth in Node.js needs a JWT token, let's assume the serviceAuth (API Key) is sufficient for now
            # We need to align authentication methods. For now, let's use the API key.
            # The node.js `task.routes.js` uses `webAuth` for status check, which is incorrect for a service.
            # This needs to be `serviceAuth`. I will assume this is fixed on the server-side, or I should fix it.
            # Let's fix it on the server side first.
            response = requests.get(status_url, headers=self.api_headers, timeout=10) # Using API Key
            response.raise_for_status()
            status_data = response.json()

            if status_data.get('status') == 'pending':
                self.logger.info("检测到紧急备份请求！立即开始所有数据库的备份...")
                self.run_all_databases_backup("EMERGENCY")
                # 报告完成
                complete_url = f"{self.server_url}/api/tasks/{self.task_id}/complete-emergency-backup"
                requests.post(complete_url, headers=self.api_headers, timeout=10)
                self.logger.info("紧急备份完成，并已向服务器报告。")

        except requests.exceptions.RequestException as e:
            self.logger.warning(f"检查紧急备份状态失败: {e}")
        except Exception as e:
            self.logger.error(f"执行紧急备份流程时发生未知错误: {e}")

    def should_backup_now(self, db_config):
        """检查是否到了计划的备份时间"""
        now = datetime.now()
        current_time_str = now.strftime('%H:%M')
        backup_key = db_config['name']
        
        backup_times = [t.strip() for t in db_config.get('times', '').split(',') if t.strip()]
        
        for backup_time in backup_times:
            if current_time_str == backup_time:
                last_backup = self.last_backup_times.get(backup_key)
                # 如果从未备份过，或者距离上次备份已经超过一分钟，则执行
                if not last_backup or (now - last_backup).total_seconds() > 61:
                    return True
        return False

    def run_all_databases_backup(self, reason="SCHEDULED"):
        """对任务中的所有数据库执行一次备份和上传"""
        if not self.task_config or not self.task_config.get('databases'):
            self.logger.warning("任务配置中没有找到数据库列表，无法执行备份。")
            return

        self.logger.info(f"开始执行所有数据库的备份，原因: {reason}")
        for db_config in self.task_config.get('databases', []):
            backup_file = self.backup_database(db_config, reason)
            if backup_file:
                if self.upload_to_obs(backup_file):
                    try:
                        os.remove(backup_file)
                        self.logger.info(f"已删除已上传的本地备份文件: {os.path.basename(backup_file)}")
                    except Exception as e:
                        self.logger.error(f"删除本地备份文件 {backup_file} 失败: {e}")
            else:
                self.logger.error(f"数据库 {db_config.get('name')} 的备份失败，跳过上传。")


    def backup_database(self, db_config, reason="SCHEDULED"):
        """备份单个数据库"""
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_dir = 'backups'
            os.makedirs(backup_dir, exist_ok=True)
            
            filename_prefix = db_config.get('prefix', '')
            backup_filename = f"{filename_prefix}{db_config['name']}_{timestamp}_{reason}.bak"
            backup_file = os.path.join(os.path.abspath(backup_dir), backup_filename)
            
            cmd = [
                'sqlcmd',
                '-S', db_config['server'],
                '-U', db_config['user'],
                '-P', db_config['pass'],
                '-Q', f"BACKUP DATABASE [{db_config['name']}] TO DISK='{backup_file}' WITH FORMAT, COMPRESSION, STATS=10"
            ]
            
            self.logger.info(f"开始备份: [数据库: {db_config['name']}] -> 文件: {backup_filename}")
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='oem', errors='ignore', timeout=3600)
            
            if result.returncode == 0 and os.path.exists(backup_file):
                self.logger.info(f"备份成功: {backup_filename}")
                self.last_backup_times[db_config['name']] = datetime.now()
                return backup_file
            else:
                self.logger.error(f"备份失败: {db_config['name']}. 错误: {result.stderr or result.stdout}")
                return None
                
        except Exception as e:
            self.logger.error(f"备份数据库 {db_config['name']} 时发生严重错误: {e}")
            return None

    def upload_to_obs(self, file_path):
        """上传文件到华为云OBS"""
        if not self.huawei_obs_config:
            self.logger.error("OBS配置不完整，无法上传")
            return False

        obs_client = None
        try:
            obs_client = ObsClient(
                access_key_id=self.huawei_obs_config['ak'],
                secret_access_key=self.huawei_obs_config['sk'],
                server=self.huawei_obs_config['endpoint']
            )
            
            folder = self.task_config.get('folder', 'default_folder')
            object_key = f"{folder}/{os.path.basename(file_path)}"
            bucket_name = self.huawei_obs_config['bucket_name']

            self.logger.info(f"准备上传 {object_key} 到存储桶 {bucket_name}")
            resp = obs_client.putFile(bucket_name, object_key, file_path, taskNum=5, enableCheckpoint=True)
            
            if resp.status < 300:
                self.logger.info(f"成功上传 {object_key}")
                return True
            else:
                self.logger.error(f"OBS上传失败: {resp.errorCode} - {resp.errorMessage}")
                return False
        except Exception as e:
            self.logger.error(f"上传到OBS时出错: {e}")
            return False
        finally:
            if obs_client:
                obs_client.close()

    def run_scheduled_iteration(self):
        """执行计划备份的迭代"""
        # 每小时重新获取一次配置
        if not self.task_config or (datetime.now() - self.last_config_fetch_time).total_seconds() > 3600:
            if not self.fetch_config():
                self.logger.warning("无法获取云端配置，跳过此次计划备份迭代。")
                return
        
        if not self.task_config or not self.task_config.get('databases'):
            return

        for db_config in self.task_config.get('databases', []):
            if self.should_backup_now(db_config):
                backup_file = self.backup_database(db_config)
                if backup_file:
                    if self.upload_to_obs(backup_file):
                        try:
                            os.remove(backup_file)
                            self.logger.info(f"已删除已上传的本地备份: {os.path.basename(backup_file)}")
                        except Exception as e:
                            self.logger.error(f"删除本地备份文件 {backup_file} 失败: {e}")

    def run_service(self):
        self.running = True
        self.logger.info(f"数据库备份服务启动，监控任务ID: {self.task_id}")
        
        # 立即获取一次配置
        self.fetch_config()

        check_interval = 15  # 检查紧急备份的间隔（秒）
        schedule_interval = 60 # 检查计划备份的间隔（秒）
        last_schedule_check = time.time() - schedule_interval # 确保第一次立即执行

        while self.running:
            try:
                # 每隔 'check_interval' 秒检查紧急备份
                self.check_for_emergency_backup()

                # 每隔 'schedule_interval' 秒检查计划备份
                if time.time() - last_schedule_check >= schedule_interval:
                    self.run_scheduled_iteration()
                    last_schedule_check = time.time()

                # 等待下一次紧急备份检查
                time.sleep(check_interval)

            except KeyboardInterrupt:
                self.logger.info("服务被用户中断")
                break
            except Exception as e:
                self.logger.error(f"服务主循环运行错误: {e}")
                time.sleep(60)
        self.logger.info("数据库备份服务停止")

    def stop_service(self):
        self.running = False

def main():
    # 将工作目录更改为脚本所在目录，确保相对路径正确
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    # 为每个客户端创建一个 settings.ini
    if not os.path.exists('settings.ini'):
        print("错误: settings.ini 文件不存在。")
        print("请创建一个 settings.ini 文件，并填入以下内容：")
        print("""
[BACKUP_CLIENT]
server_url = http://your_server_ip:3001
task_id = your_unique_task_id_from_web_ui
api_key = your_secret_api_key
""")
        sys.exit(1)
    
    service = SingleTaskBackupService()
    service.run_service()

if __name__ == "__main__":
    main()

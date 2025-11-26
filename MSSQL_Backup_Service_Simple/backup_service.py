#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import logging
import configparser
import subprocess
from datetime import datetime, timedelta

try:
    import requests
    from obs import ObsClient
except ImportError:
    print("请先安装依赖: pip install requests esdk-obs-python")
    sys.exit(1)

class DatabaseBackupService:
    """数据库备份服务核心类，根据云端配置执行任务"""
    
    def __init__(self, settings_path='settings.ini'):
        self.settings_path = settings_path
        self.settings = self.load_settings()
        self.setup_logging()
        self.running = False
        self.last_backup_times = {} # Key: task_name + db_name
        self.cloud_config = None
        self.last_config_fetch_time = None

    def load_settings(self):
        config = configparser.ConfigParser()
        if not os.path.exists(self.settings_path):
            raise FileNotFoundError(f"API配置文件 {self.settings_path} 不存在")
        config.read(self.settings_path, encoding='utf-8')
        return config

    def fetch_cloud_config(self):
        try:
            api_url = self.settings.get('api', 'url')
            api_key = self.settings.get('api', 'api_key')
            headers = {'x-api-key': api_key}
            
            self.logger.info(f"正在从 {api_url} 获取最新配置...")
            response = requests.get(api_url, headers=headers, timeout=15)
            response.raise_for_status()
            
            self.cloud_config = response.json()
            self.last_config_fetch_time = datetime.now()
            self.logger.info(f"成功获取并加载 {len(self.cloud_config.get('tasks', []))} 个备份任务。")
            return True
        except requests.exceptions.RequestException as e:
            self.logger.error(f"获取云端配置失败: {e}")
            return False
        except Exception as e:
            self.logger.error(f"处理云端配置时出错: {e}")
            return False

    def setup_logging(self):
        formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        file_handler = logging.FileHandler('backup_service.log', encoding='utf-8')
        file_handler.setLevel(logging.INFO)
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.INFO)
        self.logger.handlers = []
        self.logger.addHandler(file_handler)
        self.logger.addHandler(console_handler)
        self.logger.propagate = False
    
    def should_backup_now(self, task_name, db_config):
        now = datetime.now()
        current_time_str = now.strftime('%H:%M')
        backup_key = f"{task_name}-{db_config['name']}"
        
        backup_times = [t.strip() for t in db_config.get('times', '').split(',') if t.strip()]
        
        for backup_time in backup_times:
            if current_time_str == backup_time:
                last_backup = self.last_backup_times.get(backup_key)
                if not last_backup or (now - last_backup).total_seconds() > 61: # 61s buffer
                    return True
        return False
    
    def backup_database(self, task_config, db_config):
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_dir = 'backups'
            os.makedirs(backup_dir, exist_ok=True)
            
            # Filename: prefix_dbname_timestamp.bak
            filename_prefix = db_config.get('prefix', '')
            backup_filename = f"{filename_prefix}{db_config['name']}_{timestamp}.bak"
            backup_file = os.path.join(os.path.abspath(backup_dir), backup_filename)
            
            cmd = [
                'sqlcmd',
                '-S', db_config['server'],
                '-U', db_config['user'],
                '-P', db_config['pass'],
                '-Q', f"BACKUP DATABASE [{db_config['name']}] TO DISK='{backup_file}' WITH FORMAT, STATS=10"
            ]
            
            self.logger.info(f"开始备份: [任务: {task_config['name']}] -> [数据库: {db_config['name']}]")
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='oem', errors='ignore', timeout=3600)
            
            if result.returncode == 0 and os.path.exists(backup_file):
                self.logger.info(f"备份成功: {backup_filename}")
                backup_key = f"{task_config['name']}-{db_config['name']}"
                self.last_backup_times[backup_key] = datetime.now()
                return backup_file
            else:
                self.logger.error(f"备份失败: {db_config['name']}. 错误: {result.stderr or result.stdout}")
                return None
                
        except Exception as e:
            self.logger.error(f"备份数据库 {db_config['name']} 时发生严重错误: {e}")
            return None
    
    def upload_to_obs(self, file_path, task_config):
        if not self.cloud_config or 'huawei_obs' not in self.cloud_config:
            self.logger.error("OBS配置不完整，无法上传")
            return False

        obs_config = self.cloud_config['huawei_obs']
        obs_client = None
        try:
            obs_client = ObsClient(
                access_key_id=obs_config['ak'],
                secret_access_key=obs_config['sk'],
                server=obs_config['endpoint']
            )
            
            folder = task_config.get('folder', 'default_folder')
            object_key = f"{folder}/{os.path.basename(file_path)}"
            bucket_name = obs_config['bucket_name']

            self.logger.info(f"准备上传 {object_key} 到存储桶 {bucket_name}")
            resp = obs_client.putFile(bucket_name, object_key, file_path)
            
            if resp.status < 300:
                self.logger.info(f"成功上传 {object_key}")
                return True
            else:
                self.logger.error(f"OBS上传失败: {resp.errorMessage}")
                return False
        except Exception as e:
            self.logger.error(f"上传到OBS时出错: {e}")
            return False
        finally:
            if obs_client:
                obs_client.close()

    def run_service_iteration(self):
        # Fetch config every 5 minutes
        if not self.cloud_config or (datetime.now() - self.last_config_fetch_time).total_seconds() > 300:
            if not self.fetch_cloud_config():
                self.logger.warning("无法获取云端配置，跳过此次迭代。")
                return
        
        if not self.cloud_config or not self.cloud_config.get('tasks'):
            return

        for task_config in self.cloud_config['tasks']:
            for db_config in task_config.get('databases', []):
                if self.should_backup_now(task_config['name'], db_config):
                    backup_file = self.backup_database(task_config, db_config)
                    if backup_file:
                        if self.upload_to_obs(backup_file, task_config):
                            try:
                                os.remove(backup_file)
                                self.logger.info(f"已删除已上传的本地备份: {os.path.basename(backup_file)}")
                            except Exception as e:
                                self.logger.error(f"删除本地备份文件 {backup_file} 失败: {e}")

    def run_service(self):
        self.running = True
        self.logger.info("数据库备份服务启动（云端配置模式）")
        
        while self.running:
            try:
                self.run_service_iteration()
                time.sleep(60)
            except KeyboardInterrupt:
                self.logger.info("服务被用户中断")
                break
            except Exception as e:
                self.logger.error(f"服务主循环运行错误: {e}")
                time.sleep(300)
        self.logger.info("数据库备份服务停止")
    
    def stop_service(self):
        self.running = False

def main():
    # Change working directory to script's directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    service = DatabaseBackupService()
    service.run_service()

if __name__ == "__main__":
    main()


import os
import sys
import time
import json
import logging
import configparser
import subprocess
from datetime import datetime, time as time_obj

try:
    import requests
    from obs import ObsClient
except ImportError:
    print("请先安装依赖: pip install requests esdk-obs-python")
    sys.exit(1)

class BackupTaskRunner:
    """根据指定的任务ID执行备份的服务，增加了自我调度和失败重试功能"""

    def __init__(self, task_id, settings_path='settings.ini'):
        self.task_id = task_id
        self.settings_path = settings_path
        self.settings = self.load_settings()
        
        self.log_dir = 'logs'
        os.makedirs(self.log_dir, exist_ok=True)
        self.failed_log_path = os.path.join(self.log_dir, 'failed_uploads.log')
        self.state_file_path = os.path.join(self.log_dir, 'last_backup_times.json')
        self.setup_logging()

        self.task_config = None
        self.huawei_obs_config = None
        self.last_config_fetch_time = None
        self.server_url = self.settings.get('BACKUP_CLIENT', 'server_url')
        self.api_headers = {'Content-Type': 'application/json'}

    # --- 配置和状态管理 ---

    def _reload_local_settings(self):
        """重新加载本地 settings.ini 文件并动态更新实例状态，实现热重载。"""
        try:
            # 在服务初始化早期，logger可能尚未存在，需要进行防御性检查
            logger = self.logger if hasattr(self, 'logger') and self.logger else logging.getLogger(__name__)
            
            new_settings = self.load_settings()
            # 从新配置中安全地获取 task_id
            new_task_id = new_settings.get('BACKUP_CLIENT', 'task_id', fallback=None)

            # 仅当 task_id 存在且发生变化时，才执行热更新逻辑
            if new_task_id and self.task_id != new_task_id:
                logger.info(f"检测到 task_id 从 '{self.task_id}' 变更为 '{new_task_id}'。正在更新服务状态...")
                self.task_id = new_task_id
                self.settings = new_settings # 关键：更新整个 settings 对象
                self.server_url = self.settings.get('BACKUP_CLIENT', 'server_url')
                
                # task_id 变更后，需要更新日志记录器以使用新的日志文件，并强制刷新云端配置
                self.setup_logging()
                # 强制刷新配置，因为任务ID已经改变
                self.fetch_config(force_refresh=True)
        except Exception as e:
            # 保证即使在最糟糕的情况下也能记录下错误
            if 'logger' in locals() and logger:
                logger.error(f"热重载 settings.ini 失败: {e}", exc_info=True)
            else:
                logging.error(f"热重载 settings.ini 失败 (logger不可用): {e}", exc_info=True)


    def load_settings(self):
        config = configparser.ConfigParser()
        if not os.path.exists(self.settings_path):
            raise FileNotFoundError(f"客户端配置文件 {self.settings_path} 不存在")
        config.read(self.settings_path, encoding='utf-8-sig')
        return config

    def setup_logging(self):
        log_file = os.path.join(self.log_dir, f"task_{self.task_id}.log")
        formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        
        # Use TimedRotatingFileHandler for daily log rotation at midnight.
        file_handler = logging.handlers.TimedRotatingFileHandler(
            log_file,
            when='midnight', # Rotate at midnight
            backupCount=30,  # Keep 30 days of logs
            encoding='utf-8'
        )
        file_handler.suffix = "%Y-%m-%d" # Append date to old log files
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

    def _load_state(self):
        """加载上一次成功备份的时间记录"""
        try:
            with open(self.state_file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save_state(self, state):
        """保存最新的成功备份时间记录"""
        try:
            with open(self.state_file_path, 'w', encoding='utf-8') as f:
                json.dump(state, f, indent=4)
        except Exception as e:
            self.logger.error(f"保存状态文件失败: {e}")

    def _update_last_backup_time(self, db_name, scheduled_time_str):
        """更新指定数据库在特定时间点上的最后备份成功时间"""
        state = self._load_state()
        db_key = f"{db_name}@{scheduled_time_str}"
        state[db_key] = datetime.now().isoformat()
        self._save_state(state)
        self.logger.info(f"已更新数据库 '{db_name}' 在计划时间点 '{scheduled_time_str}' 的最后成功备份时间记录。")

    def fetch_config(self, force_refresh=False):
        """从服务器获取配置，增加缓存机制避免频繁请求"""
        now = datetime.now()
        if not force_refresh and self.task_config and self.last_config_fetch_time and (now - self.last_config_fetch_time).total_seconds() < 3600:
            return True # 如果配置存在且不到一小时，则不刷新

        self.logger.info("正在从云端获取或刷新任务配置...")
        try:
            task_api_url = f"{self.server_url}/api/tasks/{self.task_id}/config"
            response = requests.get(task_api_url, timeout=15)
            response.raise_for_status()
            
            config_data = response.json()
            self.huawei_obs_config = config_data.get('huawei_obs') if isinstance(config_data, dict) else None
            task_payload = None
            if isinstance(config_data, dict):
                task_payload = config_data.get('task')
                if task_payload is None and 'databases' in config_data:
                    task_payload = config_data

            if not task_payload:
                self.report_failure("从服务器获取的配置中缺少任务信息")
                return False

            if not self.huawei_obs_config:
                self.report_failure("从服务器获取的配置中缺少OBS信息")
                return False

            self.task_config = task_payload
            task_name = self.task_config.get('name') or self.task_id
            self.logger.info(f"成功加载并缓存了任务 '{task_name}' 的配置。")
            self.last_config_fetch_time = now
            return True
        except requests.exceptions.RequestException as e:
            self.logger.error(f"从云端获取配置失败: {e}")
            return False
        except Exception as e:
            self.report_failure(f"处理云端配置时出错: {e}")
            return False

    # --- 核心备份与上传逻辑 ---
    def backup_database(self, db_config, reason="SCHEDULED"):
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_dir = 'backups'
            os.makedirs(backup_dir, exist_ok=True)
            backup_filename = f"{db_config['name']}_{timestamp}_{reason}.bak"
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
                return backup_file
            else:
                error_msg = f"备份失败: {db_config['name']}. 错误: {result.stderr or result.stdout}"
                self.report_failure(error_msg)
                return None
        except Exception as e:
            self.report_failure(f"备份数据库 {db_config['name']} 时发生严重错误: {e}")
            return None

    def upload_to_obs(self, file_path):
        if not self.huawei_obs_config:
            self.logger.error("OBS配置不完整，无法上传")
            return False
        obs_client = None
        try:
            obs_client = ObsClient(access_key_id=self.huawei_obs_config['ak'], secret_access_key=self.huawei_obs_config['sk'], server=self.huawei_obs_config['endpoint'])
            folder = self.task_config.get('folder', 'default_folder')
            object_key = f"{folder}/{os.path.basename(file_path)}"
            bucket_name = self.huawei_obs_config['bucket_name']
            self.logger.info(f"准备上传 {object_key} 到存储桶 {bucket_name}")
            resp = obs_client.putFile(bucket_name, object_key, file_path)
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

    # --- 失败重试与报告 ---
    def _record_failed_upload(self, file_path):
        try:
            with open(self.failed_log_path, 'a', encoding='utf-8') as f:
                f.write(file_path + '\n')
            self.logger.warning(f"已将上传失败的文件 {os.path.basename(file_path)} 添加到重试队列。")
        except Exception as e:
            self.logger.error(f"记录失败文件 {file_path} 到队列时出错: {e}")

    def _retry_failed_uploads(self):
        if not os.path.exists(self.failed_log_path) or os.path.getsize(self.failed_log_path) == 0:
            return
        self.logger.info("检测到待处理的失败任务，开始执行补传...")
        try:
            with open(self.failed_log_path, 'r', encoding='utf-8') as f:
                pending_files = [line.strip() for line in f if line.strip()]
        except FileNotFoundError:
            return
        remaining_failures = []
        for file_path in pending_files:
            if not os.path.exists(file_path):
                self.logger.warning(f"待补传文件 {file_path} 已不存在，将从队列中移除。")
                continue
            self.logger.info(f"正在尝试补传: {os.path.basename(file_path)}")
            if self.upload_to_obs(file_path):
                self.logger.info(f"成功补传文件: {os.path.basename(file_path)}")
                try:
                    os.remove(file_path)
                    self.logger.info(f"已删除已补传的本地备份文件: {os.path.basename(file_path)}")
                except Exception as e:
                    self.logger.error(f"删除已补传的本地文件 {file_path} 失败: {e}")
            else:
                self.logger.error(f"补传文件 {os.path.basename(file_path)} 再次失败，将保留在队列中。")
                remaining_failures.append(file_path)
        try:
            with open(self.failed_log_path, 'w', encoding='utf-8') as f:
                for file_path in remaining_failures:
                    f.write(file_path + '\n')
            if not remaining_failures:
                self.logger.info("所有失败的任务均已成功补传！")
        except Exception as e:
            self.logger.error(f"更新失败上传队列文件时出错: {e}")

    def report_failure(self, error_message):
        self.logger.error(error_message)
        try:
            url = f"{self.server_url}/api/tasks/{self.task_id}/report-failure"
            requests.post(url, json={'error': str(error_message)}, timeout=10)
            self.logger.info("已尝试向服务器报告失败状态。")
        except requests.exceptions.RequestException as e:
            self.logger.error(f"向服务器报告失败状态时出错: {e}")

    def complete_emergency_backup(self):
        try:
            url = f"{self.server_url}/api/tasks/{self.task_id}/complete-emergency-backup"
            requests.post(url, timeout=10)
            self.logger.info("已通知服务器紧急备份完成。")
        except requests.exceptions.RequestException as e:
            self.logger.warning(f"通知服务器紧急备份完成时失败: {e}")

    # --- 任务执行 ---
    def execute_scheduled_backup(self, db_config, scheduled_time_str):
        """为单个数据库在特定时间点执行一次完整的定时备份、上传、记录流程"""
        self.logger.info(f"开始为数据库 '{db_config['name']}' 在计划时间点 '{scheduled_time_str}' 执行错过的定时备份...")
        backup_file = self.backup_database(db_config, reason="SCHEDULED")
        if backup_file:
            if self.upload_to_obs(backup_file):
                self._update_last_backup_time(db_config['name'], scheduled_time_str)
                # [已修复] 在定时备份上传成功后，也删除本地文件
                try:
                    os.remove(backup_file)
                    self.logger.info(f"已删除已上传的本地定时备份文件: {os.path.basename(backup_file)}")
                except Exception as e:
                    self.logger.error(f"删除本地定时备份文件 {backup_file} 失败: {e}")
            else:
                self._record_failed_upload(backup_file)

    def execute_emergency_backup(self):
        """为任务下的所有数据库执行紧急备份"""
        self.logger.info(f"开始为任务ID: {self.task_id} 执行紧急备份")
        if not self.task_config or not self.task_config.get('databases'):
            self.report_failure("任务配置中没有找到数据库列表，无法执行备份。")
            return
        all_success = True
        for db_config in self.task_config.get('databases', []):
            backup_file = self.backup_database(db_config, reason="EMERGENCY")
            if backup_file:
                if self.upload_to_obs(backup_file):
                    try:
                        os.remove(backup_file)
                    except Exception as e:
                        self.logger.error(f"删除紧急备份文件 {backup_file} 失败: {e}")
                else:
                    self._record_failed_upload(backup_file)
                    all_success = False
            else:
                all_success = False
        if all_success:
            self.complete_emergency_backup()
        self.logger.info(f"紧急备份任务 {self.task_id} 执行完毕。")

    # --- 主循环逻辑 ---
    def _check_and_run_scheduled_backups(self):
        """【核心】检查并执行错过的定时备份，支持多个时间点"""
        if not self.task_config or not self.task_config.get('databases'):
            return

        now = datetime.now()
        state = self._load_state()

        for db_config in self.task_config['databases']:
            db_name = db_config.get('name')
            scheduled_times_str = db_config.get('times')
            if not db_name or not scheduled_times_str:
                continue

            time_points = [t.strip() for t in scheduled_times_str.split(',')]

            for time_str in time_points:
                try:
                    hour, minute = map(int, time_str.split(':'))
                    scheduled_datetime_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                except ValueError:
                    self.logger.warning(f"数据库 '{db_name}' 的备份时间 '{time_str}' 格式无效，已跳过。")
                    continue

                db_key = f"{db_name}@{time_str}"
                last_backup_str = state.get(db_key)
                last_backup_datetime = datetime.fromisoformat(last_backup_str) if last_backup_str else None

                if now >= scheduled_datetime_today and (not last_backup_datetime or last_backup_datetime < scheduled_datetime_today):
                    self.execute_scheduled_backup(db_config, time_str)
    
    def check_and_execute(self):
        """服务主循环调用的唯一入口"""
        self._reload_local_settings() # 在每个周期的开始重新加载本地配置
        try:
            status_url = f"{self.server_url}/api/tasks/{self.task_id}/status"
            response = requests.get(status_url, timeout=10)

            if response.status_code == 200:
                if not self.fetch_config():
                    self.logger.warning("无法获取配置，跳过此周期。")
                    return
                
                self._retry_failed_uploads()
                self._check_and_run_scheduled_backups()
                
                status_data = response.json()
                if status_data.get('emergency_backup') == 'pending':
                    self.logger.info("检测到服务器端的紧急备份请求！")
                    self.execute_emergency_backup()
                    # 只有在完成由服务器发起的紧急备份后，才通知服务器
                    self.complete_emergency_backup()
                else:
                    self.logger.info(f"云端状态正常 ({status_data.get('status')})，无紧急任务。")

            else:
                self.logger.warning(f"检查任务状态失败，服务器返回: {response.status_code}")

        except requests.exceptions.RequestException:
            self.logger.warning(f"网络错误：无法连接到服务器检查状态。将等待下一个周期。")
        except Exception as e:
            self.logger.error(f"在检查执行周期中发生未知错误: {e}", exc_info=True)

# --- 命令行入口 ---
def main():
    if len(sys.argv) != 3:
        print("用法: python backup_service.py <task_id> <EMERGENCY|SCHEDULED>")
        sys.exit(1)
    task_id = sys.argv[1]
    backup_type = sys.argv[2].upper()
    if backup_type not in ["EMERGENCY", "SCHEDULED"]:
        print("错误: 备份类型必须是 'EMERGENCY' 或 'SCHEDULED'")
        sys.exit(1)
    
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.exists('settings.ini'):
        print("错误: settings.ini 文件不存在。")
        return
    runner = BackupTaskRunner(task_id)
    if not runner.fetch_config(force_refresh=True):
        print("无法从服务器获取配置，操作中止。")
        return
    if backup_type == "EMERGENCY":
        runner.execute_emergency_backup()
    elif backup_type == "SCHEDULED":
        print("手动执行所有数据库的定时备份...")
        for db in runner.task_config.get('databases',[]):
             runner.execute_scheduled_backup(db, "manual") # a time string is needed, use "manual"

if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
import os
import sys
import requests
from datetime import datetime, time, timedelta

# 尝试导入OBS SDK，如果未安装则提示
try:
    from obs import ObsClient
except ImportError:
    print("错误: 依赖库 esdk-obs-python 未安装。")
    print("请在服务器上执行: pip install esdk-obs-python requests")
    sys.exit(1)

# --- 服务器配置 (请根据您的实际环境修改) ---

# 您的中心服务器API地址
API_BASE_URL = "http://82.156.83.99:11451"

# 需要检查的所有任务ID列表
# 您可以从服务器数据库或配置文件中动态获取此列表
TASK_IDS = [
    "temp-1764980841293-ea840c83971798",
    # "task-id-002",
    # "task-id-003",
]

# --- 核心检查逻辑 ---

def get_task_config(task_id):
    """从API获取指定任务的完整配置"""
    try:
        url = f"{API_BASE_URL}/api/tasks/{task_id}/config"
        response = requests.get(url, timeout=20)
        response.raise_for_status() # 如果请求失败 (非2xx状态码)，则抛出异常
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"[任务: {task_id}] 失败: 无法从API获取配置。错误: {e}")
        return None

def check_backup_status(obs_client, bucket_name, object_key_prefix):
    """在OBS中检查是否存在以特定前缀开头的备份文件"""
    try:
        # 列出所有以该前缀开头的对象
        resp = obs_client.listObjects(bucketName=bucket_name, prefix=object_key_prefix, max_keys=1)
        # 如果能找到至少一个对象，就认为备份存在
        if resp.status < 300 and resp.body.contents:
            # 找到了匹配的对象
            found_key = resp.body.contents[0].key
            print(f"  -> 成功: 在OBS中找到匹配的备份文件: {os.path.basename(found_key)}")
            return True
        else:
            # 找不到任何匹配的对象
            print(f"  -> 失败: 在OBS存储桶 [31m{bucket_name}[0m 中未找到任何以 [33m{object_key_prefix}[0m 开头的备份文件。")
            return False
    except Exception as e:
        print(f"  -> 失败: 检查OBS时发生异常: {e}")
        return False

def main():
    """主检查函数"""
    print(f"--- 开始执行备份状态每日检查 ({datetime.now().strftime("%Y-%m-%d %H:%M:%S")}) ---")
    
    if not TASK_IDS:
        print("警告: 任务ID列表为空，没有可检查的任务。请编辑此脚本并填充 TASK_IDS。")
        return

    # 遍历所有任务ID
    for task_id in TASK_IDS:
        print(f"\n--- 正在检查任务: {task_id} ---")
        
        # 1. 获取任务配置
        config = get_task_config(task_id)
        if not config or not isinstance(config, dict):
            continue # 获取配置失败，跳到下一个任务

        task_info = config.get("task", {})
        obs_info = config.get("huawei_obs", {})
        databases = task_info.get("databases", [])
        task_name = task_info.get("name", "未命名")
        obs_folder = task_info.get("folder", task_id)

        if not all([obs_info, databases]):
            print(f"[任务: {task_name}] 失败: 配置不完整 (缺少OBS或数据库信息)。")
            continue

        # 2. 初始化OBS客户端
        try:
            obs_client = ObsClient(
                access_key_id=obs_info["ak"],
                secret_access_key=obs_info["sk"],
                server=obs_info["endpoint"]
            )
            bucket_name = obs_info["bucket_name"]
        except KeyError as e:
            print(f"[任务: {task_name}] 失败: OBS配置信息不完整，缺少键: {e}")
            continue
        except Exception as e:
            print(f"[任务: {task_name}] 失败: 初始化OBS客户端时出错: {e}")
            continue

        # 3. 遍历任务中的每个数据库和备份时间点
        check_time = datetime.now() # 当前检查时间
        print(f"当前检查时间: {check_time.strftime("%H:%M:%S")}")

        for db in databases:
            db_name = db.get("name")
            backup_times_str = db.get("times")
            if not all([db_name, backup_times_str]):
                print(f"  - [33m跳过[0m: 数据库 [34m{db_name or '未知数据库'}[0m 的配置不完整 (缺少名称或备份时间)。")
                continue

            # 一个数据库可能配置了多个备份时间点
            for backup_time_str in backup_times_str.split(","):
                backup_time_str = backup_time_str.strip()
                try:
                    backup_t = time.fromisoformat(backup_time_str)
                except ValueError:
                    print(f"  - [31m错误[0m: 数据库 [34m{db_name}[0m 的备份时间格式 [33m{backup_time_str}[0m 无效。")
                    continue
                
                print(f"\n  - 正在验证数据库 [34m{db_name}[0m 的备份点 [32m{backup_time_str}[0m")

                # 4. 核心逻辑：确定要检查的日期
                target_date = check_time.date()
                if check_time.time() < backup_t:
                    # 如果检查时间早于今天的备份时间，则检查昨天的备份
                    target_date = check_time.date() - timedelta(days=1)
                    print(f"    检查时间 ({check_time.strftime("%H:%M")}) 早于备份时间 ({backup_time_str})，将检查 [36m昨天 ({target_date.strftime('%Y-%m-%d')})[0m 的备份。")
                else:
                    # 否则，检查今天的备份
                    print(f"    检查时间 ({check_time.strftime("%H:%M")}) 晚于或等于备份时间 ({backup_time_str})，将检查 [36m今天 ({target_date.strftime('%Y-%m-%d')})[0m 的备份。")

                # 5. 构建预期的OBS对象键前缀
                # 格式: my-folder/MyDB_20251210
                date_str = target_date.strftime("%Y%m%d")
                object_key_prefix = f"{obs_folder}/{db_name}_{date_str}"
                
                # 6. 在OBS中执行检查
                check_backup_status(obs_client, bucket_name, object_key_prefix)
        
        # 7. 关闭OBS客户端连接
        obs_client.close()
    
    print("\n--- 每日检查执行完毕 ---")

if __name__ == "__main__":
    main()

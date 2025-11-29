import os
import sys
from obs import ObsClient

def download_config_from_obs():
    """
    Downloads the config.json file from Huawei OBS using credentials
    from environment variables.
    """
    try:
        # 从环境变量中安全地获取凭证和参数
        access_key_id = os.environ['HUAWEI_OBS_AK']
        secret_access_key = os.environ['HUAWEI_OBS_SK']
        endpoint = "obs.cn-north-4.myhuaweicloud.com"
        bucket_name = "yidianjicheng-backeup"
        object_key = "config/config.json"
        local_file_path = "config.json" # 下载到项目根目录

        if not all([access_key_id, secret_access_key]):
            print("错误：必须设置 HUAWEI_OBS_AK 和 HUAWEI_OBS_SK 环境变量。", file=sys.stderr)
            sys.exit(1)

        print(f"--- [Python脚本] 正在初始化OBS客户端，目标节点: {endpoint} ---")
        # SDK 需要协议头 https://
        obs_client = ObsClient(
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            server=f"https://{endpoint}" 
        )

        print(f"--- [Python脚本] 正在从存储桶 '{bucket_name}' 下载对象 '{object_key}'... ---")
        resp = obs_client.getObject(bucket_name, object_key, downloadPath=local_file_path)

        if resp.status < 300:
            print(f"--- [Python脚本] 成功下载配置文件到 '{local_file_path}'。 ---")
        else:
            print(f"错误：下载对象失败。HTTP状态码: {resp.status}", file=sys.stderr)
            print(f"错误详情: {resp.body}", file=sys.stderr)
            sys.exit(1)

    except Exception as e:
        print(f"发生意外错误: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if 'obs_client' in locals() and obs_client:
            obs_client.close()

if __name__ == "__main__":
    download_config_from_obs()

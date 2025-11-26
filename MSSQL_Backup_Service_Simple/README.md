# MSSQL数据库备份服务 - 精简版

一个轻量级的MSSQL数据库自动备份服务，支持定时备份和华为云OBS上传。

## 快速开始

### 1. 安装服务
以管理员身份运行：
```bash
install_simple.bat
```

### 2. 配置数据库
编辑 `config.ini` 文件：
```ini
[database_你的数据库名]
server=localhost
database_name=你的数据库名
username=sa
password=你的密码
enabled=yes
backup_times=08:30,21:00
hourly_backup=no

[obs]
access_key=你的AccessKey
secret_key=你的SecretKey
bucket_name=你的存储桶名
endpoint=obs.cn-north-4.myhuaweicloud.com

[backup_schedule]
local_path=backups
upload_delay_minutes=5
retention_days=7
```

### 3. 管理服务
```bash
# 启动服务
python windows_service.py start

# 停止服务
python windows_service.py stop

# 重启服务
python windows_service.py restart

# 卸载服务
python windows_service.py remove

# 紧急备份
python backup_service.py --emergency
```

## 核心功能

- ✅ **自动定时备份**: 支持多个时间点定时备份
- ✅ **华为云OBS上传**: 自动上传到云存储
- ✅ **自动清理**: 按保留天数自动删除旧备份
- ✅ **Windows服务**: 开机自启动，后台运行
- ✅ **多数据库支持**: 可配置多个数据库
- ✅ **错误重试**: 自动处理临时错误
- ✅ **详细日志**: 记录所有操作到日志文件

## 文件说明

### 核心文件
- `backup_service.py` - 备份服务核心代码
- `windows_service.py` - Windows服务包装器
- `config.ini` - 配置文件
- `install_simple.bat` - 安装脚本

### 工具文件
- `test_service.py` - 测试脚本
- `requirements_simple.txt` - 依赖包列表
- `backup_service.log` - 日志文件
- `backups/` - 本地备份文件夹

## 配置说明

### 数据库配置
每个数据库需要一个独立的配置节，格式为 `[database_名称]`：
- `enabled=yes/no` - 是否启用此数据库备份
- `backup_times` - 备份时间，格式 HH:MM，多个时间用逗号分隔
- `hourly_backup` - 是否启用每小时备份

### 备份策略
- `upload_delay_minutes` - 备份完成后多久上传到OBS
- `retention_days` - 本地备份保留天数
- `local_path` - 本地备份存储路径

## 故障排除

### 常见问题

1. **sqlcmd命令不存在**
   - 安装 SQL Server Management Tools
   - 或安装 SQL Server Command Line Utilities

2. **权限不足**
   - 确保以管理员权限运行服务安装
   - 检查backup目录的写权限

3. **OBS连接失败**
   - 验证 access_key 和 secret_key
   - 检查 endpoint 地址是否正确
   - 确认网络连接正常

4. **服务无法启动**
   - 检查 Python 是否正确安装
   - 验证 config.ini 配置格式
   - 查看 Windows 事件日志

### 日志查看
- 应用日志：`backup_service.log`
- 服务日志：Windows事件查看器 > Windows日志 > 应用程序

### 测试命令
```bash
# 测试配置和功能
python test_service.py

# 手动执行紧急备份
python backup_service.py --emergency

# 检查服务状态
sc query MSSQLBackupService
```

## 版本信息

### 精简版改进
- 🔧 **代码精简**: 移除冗余功能，专注核心备份
- 🎯 **性能优化**: 更精确的定时逻辑，避免重复备份  
- 🛠️ **错误修复**: 解决原版本定时不准确的问题
- 📦 **依赖减少**: 只保留必需的依赖包
- 🚀 **安装简化**: 一键安装脚本

### 与原版对比
| 功能 | 原版 | 精简版 |
|------|------|--------|
| 核心文件 | 10+ | 4个 |
| 依赖包 | 8个 | 4个 |
| 定时精度 | 不准确 | 精确到分钟 |
| 安装复杂度 | 复杂 | 一键安装 |
| 代码量 | ~800行 | ~400行 |
| 系统托盘 | ✓ | ✗ (可选) |
| GUI配置 | ✓ | ✗ (配置文件) |

## 支持

如有问题，请检查：
1. `backup_service.log` 应用日志
2. Windows事件查看器中的服务日志
3. 运行 `python test_service.py` 进行诊断
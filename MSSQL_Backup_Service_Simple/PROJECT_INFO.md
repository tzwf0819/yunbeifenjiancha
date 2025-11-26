# MSSQL数据库备份服务 - 精简版

## 📁 项目文件结构

```
MSSQL_Backup_Service_Simple/
├── backup_service.py          # 核心备份服务逻辑
├── windows_service.py         # Windows服务包装器
├── config.ini                # 配置文件
├── install_simple.bat        # 一键安装脚本
├── requirements.txt          # Python依赖包列表
├── test_service.py           # 功能测试脚本
├── README.md                 # 使用说明文档
├── INSTALL_MANUAL.md         # 手动安装指南
├── OPTIMIZATION_SUMMARY.md   # 优化总结报告
├── backups/                  # 本地备份存储目录
└── PROJECT_INFO.md           # 本文件 - 项目说明
```

## 🚀 快速开始

### 1. 安装服务（推荐）
以管理员身份运行：
```cmd
install_simple.bat
```

### 2. 手动安装
```cmd
pip install -r requirements.txt
python windows_service.py install
python windows_service.py start
```

### 3. 配置数据库
编辑 `config.ini` 文件，设置您的数据库连接信息和备份时间。

### 4. 测试功能
```cmd
python test_service.py
```

### 5. 紧急备份
```cmd
python backup_service.py --emergency
```

## 📋 文件说明

### 核心文件
- **backup_service.py**: 主要的备份逻辑，包含数据库备份、OBS上传、定时任务等核心功能
- **windows_service.py**: 将备份服务包装为Windows服务，支持开机自启动
- **config.ini**: 配置文件，包含数据库连接、OBS设置、备份策略等配置

### 工具文件  
- **install_simple.bat**: 自动化安装脚本，一键完成依赖安装和服务注册
- **test_service.py**: 测试脚本，验证配置和功能是否正常
- **emergency_backup.bat**: 交互式紧急备份工具（推荐）
- **emergency_backup.py**: Python版交互式紧急备份工具
- **quick_backup.bat**: 快速紧急备份（无确认，直接执行）
- **requirements.txt**: Python依赖包列表，只包含必需的4个包

### 文档文件
- **README.md**: 详细的使用说明和配置指南
- **INSTALL_MANUAL.md**: 手动安装步骤，适用于需要逐步操作的情况
- **OPTIMIZATION_SUMMARY.md**: 详细的优化报告，说明与原版的对比

## ✨ 主要特性

- 🎯 **精简高效**: 只有400行核心代码，4个必需文件
- ⏰ **精确定时**: 修复了原版定时不准确的问题
- 🔄 **自动启动**: Windows服务自动开机启动
- 🛡️ **稳定可靠**: 完善的错误处理和恢复机制
- 📊 **详细日志**: 完整的操作日志，便于故障排查
- ☁️ **云端备份**: 支持华为云OBS自动上传
- 🗂️ **多数据库**: 支持同时备份多个数据库
- 🧹 **自动清理**: 按策略自动清理过期备份

## 🛠️ 常用管理命令

```cmd
# 服务管理
python windows_service.py start     # 启动服务
python windows_service.py stop      # 停止服务  
python windows_service.py restart   # 重启服务
python windows_service.py remove    # 卸载服务

# 紧急备份 (多种方式)
emergency_backup.bat                # 交互式紧急备份工具 (推荐)
python emergency_backup.py          # Python版交互式工具
quick_backup.bat                    # 快速备份 (无确认)
python backup_service.py --emergency # 命令行直接备份

# 测试和诊断
python test_service.py              # 测试配置和功能
sc query MSSQLBackupService        # 查看服务状态
```

## 📞 技术支持

遇到问题时请检查：
1. `backup_service.log` - 应用运行日志
2. Windows事件查看器 - 系统服务日志
3. 运行 `python test_service.py` - 功能诊断

---
**版本**: 精简优化版  
**创建时间**: 2025-09-13  
**适用于**: Windows系统 + MSSQL Server + 华为云OBS
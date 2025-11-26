# 手动安装指南

## 当前服务状态检查

运行以下命令检查服务是否存在：
```cmd
sc query MSSQLBackupService
```

## 手动安装步骤

### 1. 以管理员身份打开PowerShell或命令提示符

### 2. 切换到项目目录
```cmd
cd "你的项目路径"
```

### 3. 安装依赖包
```cmd
pip install -r requirements_simple.txt
```

### 4. 安装服务
```cmd
python windows_service.py install
```

### 5. 设置服务自动启动
```cmd
sc config MSSQLBackupService start= auto
```

### 6. 启动服务
```cmd
python windows_service.py start
```

## 验证安装

### 检查服务状态
```cmd
sc query MSSQLBackupService
```

### 查看服务日志
```cmd
python test_service.py
```

### 执行紧急备份测试
```cmd
python backup_service.py --emergency
```

## 服务管理命令

```cmd
# 启动服务
python windows_service.py start

# 停止服务
python windows_service.py stop

# 重启服务  
python windows_service.py restart

# 卸载服务
python windows_service.py remove

# 查看服务状态
sc query MSSQLBackupService
```

## 故障排除

如果遇到"拒绝访问"错误：
1. 确保以管理员身份运行
2. 检查防病毒软件是否阻止
3. 尝试手动卸载旧服务：`python windows_service.py remove`
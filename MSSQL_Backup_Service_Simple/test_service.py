#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
测试脚本 - 验证定时备份功能
"""

import sys
import os
import time
from datetime import datetime, timedelta

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backup_service import DatabaseBackupService

def test_timing_logic():
    """测试定时逻辑"""
    print("=" * 50)
    print("测试定时备份逻辑")
    print("=" * 50)
    
    try:
        service = DatabaseBackupService()
        databases = service.get_enabled_databases()
        
        print(f"发现 {len(databases)} 个启用的数据库:")
        for db in databases:
            print(f"  - {db['name']} ({db['database_name']})")
            print(f"    备份时间: {db['backup_times']}")
            print(f"    小时备份: {db['hourly_backup']}")
        
        print("\n当前时间:", datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
        print("当前时间字符串:", datetime.now().strftime('%H:%M'))
        
        # 测试每个数据库的定时逻辑
        for db in databases:
            should_backup = service.should_backup_now(db)
            print(f"\n数据库 {db['name']} 是否应该备份: {should_backup}")
            
            if should_backup:
                print("  → 触发备份条件!")
            else:
                print("  → 未到备份时间")
                
        return True
        
    except Exception as e:
        print(f"测试失败: {e}")
        return False

def test_emergency_backup():
    """测试紧急备份功能"""
    print("\n" + "=" * 50)
    print("测试紧急备份功能")
    print("=" * 50)
    
    try:
        service = DatabaseBackupService()
        
        print("开始执行紧急备份...")
        success_count = service.emergency_backup()
        
        if success_count > 0:
            print(f"✓ 紧急备份成功！备份了 {success_count} 个数据库")
            return True
        else:
            print("✗ 紧急备份失败")
            return False
            
    except Exception as e:
        print(f"紧急备份测试失败: {e}")
        return False

def test_service_iteration():
    """测试服务迭代功能"""
    print("\n" + "=" * 50)
    print("测试服务迭代功能")
    print("=" * 50)
    
    try:
        service = DatabaseBackupService()
        
        print("执行一次服务迭代...")
        service.run_service_iteration()
        print("✓ 服务迭代执行成功")
        return True
        
    except Exception as e:
        print(f"服务迭代测试失败: {e}")
        return False

def main():
    """主测试函数"""
    print("MSSQL数据库备份服务测试程序")
    print("时间:", datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    
    # 检查配置文件
    if not os.path.exists('config.ini'):
        print("错误: 找不到配置文件 config.ini")
        return
    
    tests = [
        ("定时逻辑测试", test_timing_logic),
        ("服务迭代测试", test_service_iteration),
    ]
    
    # 询问是否执行紧急备份测试
    response = input("\n是否执行紧急备份测试？(这会实际执行备份) [y/N]: ")
    if response.lower() in ['y', 'yes']:
        tests.append(("紧急备份测试", test_emergency_backup))
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        try:
            if test_func():
                passed += 1
                print(f"\n✓ {test_name} - 通过")
            else:
                print(f"\n✗ {test_name} - 失败")
        except Exception as e:
            print(f"\n✗ {test_name} - 异常: {e}")
    
    print("\n" + "=" * 50)
    print(f"测试结果: {passed}/{total} 通过")
    print("=" * 50)

if __name__ == "__main__":
    main()
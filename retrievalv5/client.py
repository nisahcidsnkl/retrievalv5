# test_client.py
import requests
import json
import sys
from datetime import datetime


class BackendTester:
    def __init__(self, base_url="http://localhost:5007"):
        """初始化测试客户端

        Args:
            base_url: 后端服务的基础URL，默认http://localhost:5007
        """
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Backend-Test-Client/1.0',
            'Content-Type': 'application/json'
        })

    def test_health(self):
        """测试 /health 接口"""
        print("\n" + "=" * 60)
        print("测试 /health 接口")
        print("=" * 60)

        try:
            url = f"{self.base_url}/health"
            print(f"请求URL: {url}")

            response = self.session.get(url, timeout=10)
            response.raise_for_status()

            data = response.json()

            print(f"状态码: {response.status_code}")
            print(f"响应时间: {response.elapsed.total_seconds():.3f}秒")
            print(f"响应状态: {data.get('status', 'unknown')}")

            print("\n健康检查详情:")
            print(f"  服务名称: {data.get('service', 'N/A')}")
            print(f"  设备: {data.get('device', 'N/A')}")
            print(f"  数据库连接: {'✅ 已连接' if data.get('db_connected') else '❌ 未连接'}")
            print(f"  模型加载: {'✅ 已加载' if data.get('model_loaded') else '❌ 未加载'}")
            print(f"  特征数量: {data.get('feature_count', 0)}")
            print(f"  样本数量: {data.get('samples_count', 0)}")
            print(f"  默认年份: {data.get('default_year', 'N/A')}")
            print(f"  瓦片根目录: {data.get('tiles_root', 'N/A')}")

            available_years = data.get('available_years', [])
            print(f"  可用年份: {available_years}")

            return True, data

        except requests.exceptions.ConnectionError:
            print("❌ 连接失败 - 请确保后端服务正在运行")
            print(f"   服务地址: {self.base_url}")
            return False, {"error": "Connection failed"}
        except requests.exceptions.Timeout:
            print("❌ 请求超时")
            return False, {"error": "Request timeout"}
        except requests.exceptions.RequestException as e:
            print(f"❌ 请求失败: {str(e)}")
            return False, {"error": str(e)}
        except json.JSONDecodeError:
            print(f"❌ JSON解析失败 - 响应内容: {response.text[:200]}")
            return False, {"error": "Invalid JSON response"}

    def test_available_years(self):
        """测试 /available_years 接口"""
        print("\n" + "=" * 60)
        print("测试 /available_years 接口")
        print("=" * 60)

        try:
            url = f"{self.base_url}/available_years"
            print(f"请求URL: {url}")

            response = self.session.get(url, timeout=10)
            response.raise_for_status()

            data = response.json()

            print(f"状态码: {response.status_code}")
            print(f"响应时间: {response.elapsed.total_seconds():.3f}秒")
            print(f"响应状态: {data.get('status', 'unknown')}")

            print("\n年份数据详情:")

            # 数据库年份
            db_years = data.get('database_years', [])
            print(f"  数据库年份 ({len(db_years)}个): {sorted(db_years)}")

            # 文件系统年份
            fs_years = data.get('filesystem_years', [])
            print(f"  文件系统年份 ({len(fs_years)}个): {sorted(fs_years)}")

            # 交集年份
            intersection = data.get('intersection', [])
            print(f"  交集年份 ({len(intersection)}个): {sorted(intersection)}")

            # 分析年份数据
            print("\n年份数据分析:")

            if db_years:
                print(f"  数据库最早年份: {min(db_years)}")
                print(f"  数据库最晚年份: {max(db_years)}")
                print(f"  数据库年份跨度: {max(db_years) - min(db_years)}年")

            if fs_years:
                print(f"  文件系统最早年份: {min(fs_years)}")
                print(f"  文件系统最晚年份: {max(fs_years)}")
                print(f"  文件系统年份跨度: {max(fs_years) - min(fs_years)}年")

            # 检查数据库和文件系统的一致性
            if db_years and fs_years:
                missing_in_fs = set(db_years) - set(fs_years)
                missing_in_db = set(fs_years) - set(db_years)

                if missing_in_fs:
                    print(f"  ⚠️  数据库中有但文件系统缺少的年份: {sorted(missing_in_fs)}")
                if missing_in_db:
                    print(f"  ⚠️  文件系统中有但数据库缺少的年份: {sorted(missing_in_db)}")
                if not missing_in_fs and not missing_in_db:
                    print("  ✅ 数据库和文件系统年份完全一致")

            return True, data

        except requests.exceptions.ConnectionError:
            print("❌ 连接失败")
            return False, {"error": "Connection failed"}
        except requests.exceptions.Timeout:
            print("❌ 请求超时")
            return False, {"error": "Request timeout"}
        except requests.exceptions.RequestException as e:
            print(f"❌ 请求失败: {str(e)}")
            return False, {"error": str(e)}
        except json.JSONDecodeError:
            print(f"❌ JSON解析失败 - 响应内容: {response.text[:200]}")
            return False, {"error": "Invalid JSON response"}

    def test_batch(self):
        """批量测试"""
        print("\n" + "=" * 60)
        print("批量测试开始")
        print("=" * 60)

        start_time = datetime.now()
        results = {}

        # 测试health接口
        success1, data1 = self.test_health()
        results['health'] = {
            'success': success1,
            'data': data1 if success1 else None,
            'error': data1.get('error') if not success1 else None
        }

        # 测试available_years接口
        success2, data2 = self.test_available_years()
        results['available_years'] = {
            'success': success2,
            'data': data2 if success2 else None,
            'error': data2.get('error') if not success2 else None
        }

        # 统计结果
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()

        print("\n" + "=" * 60)
        print("测试结果汇总")
        print("=" * 60)

        total_tests = 2
        passed_tests = sum(1 for r in results.values() if r['success'])

        print(f"测试总数: {total_tests}")
        print(f"通过测试: {passed_tests}")
        print(f"失败测试: {total_tests - passed_tests}")
        print(f"总耗时: {duration:.2f}秒")

        for test_name, result in results.items():
            status = "✅ 通过" if result['success'] else "❌ 失败"
            print(f"  {test_name}: {status}")
            if not result['success']:
                print(f"    错误信息: {result.get('error')}")

        return results


def main():
    """主函数"""
    print("后端接口测试客户端")
    print("=" * 60)

    # 获取命令行参数
    import argparse
    parser = argparse.ArgumentParser(description='后端接口测试客户端')
    parser.add_argument('--url', default='http://localhost:5007',
                        help='后端服务URL (默认: http://localhost:5007)')
    parser.add_argument('--test', choices=['health', 'years', 'all'], default='all',
                        help='选择测试项目 (默认: all)')

    args = parser.parse_args()

    # 创建测试客户端
    tester = BackendTester(base_url=args.url)

    # 执行测试
    try:
        if args.test == 'health' or args.test == 'all':
            success, data = tester.test_health()
            if not success and args.test == 'health':
                sys.exit(1)

        if args.test == 'years' or args.test == 'all':
            success, data = tester.test_available_years()
            if not success and args.test == 'years':
                sys.exit(1)

        if args.test == 'all':
            results = tester.test_batch()
            # 如果有失败的测试，返回非零退出码
            if any(not r['success'] for r in results.values()):
                sys.exit(1)

    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ 测试过程中发生未预期错误: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
# -*- coding: utf-8 -*-
"""
数据库管理模块
"""

import logging
import traceback
from typing import List, Dict, Any, Optional

import asyncpg

from config import settings, CURRENT_CONFIG


logger = logging.getLogger(__name__)

db_pool = None


class DatabaseManager:
    @staticmethod
    async def init_pool():
        global db_pool
        try:
            logger.info(f"正在连接数据库 {settings.PG_HOST}:{settings.PG_PORT}...")
            db_pool = await asyncpg.create_pool(
                host=settings.PG_HOST,
                port=settings.PG_PORT,
                user=settings.PG_USER,
                password=settings.PG_PASSWORD,
                database=settings.PG_DB,
                min_size=5,
                max_size=20
            )
            logger.info(f"数据库连接池创建成功，当前模式: {settings.ACTIVE_TABLE}")
        except Exception as e:
            logger.error(f"数据库连接失败: {str(e)}")
            raise

    @staticmethod
    async def close_pool():
        global db_pool
        if db_pool:
            await db_pool.close()

    @staticmethod
    async def get_feature_count(year: Optional[int] = None) -> int:
        if not db_pool:
            return 0
        try:
            table_name = CURRENT_CONFIG["table_name"]
            async with db_pool.acquire() as conn:
                if year is not None:
                    count = await conn.fetchval(
                        f"SELECT count(*) FROM {table_name} WHERE dataset_id = $1 AND model_id = $2 AND data_year = $3",
                        settings.DATASET_ID, settings.MODEL_ID, year
                    )
                else:
                    count = await conn.fetchval(
                        f"SELECT count(*) FROM {table_name} WHERE dataset_id = $1 AND model_id = $2",
                        settings.DATASET_ID, settings.MODEL_ID
                    )
                return count
        except Exception as e:
            logger.error(f"获取数量失败: {str(e)}")
            return 0

    @staticmethod
    async def get_available_years() -> List[int]:
        if not db_pool:
            return []
        try:
            table_name = CURRENT_CONFIG["table_name"]
            async with db_pool.acquire() as conn:
                rows = await conn.fetch(
                    f"SELECT DISTINCT data_year FROM {table_name} WHERE dataset_id = $1 AND model_id = $2 ORDER BY data_year",
                    settings.DATASET_ID, settings.MODEL_ID
                )
                return [row['data_year'] for row in rows]
        except Exception as e:
            logger.error(f"获取年份列表失败: {str(e)}")
            return []

    @staticmethod
    async def search_similar_vectors(query_vector: List[float], limit: int,
                                     year: Optional[int] = None, month: Optional[int] = None) -> List[Dict[str, Any]]:
        if not db_pool:
            raise RuntimeError("数据库未连接")

        table_name = CURRENT_CONFIG["table_name"]
        cols_per_row = CURRENT_CONFIG["cols"]

        conditions = ["dataset_id = $1", "model_id = $2"]
        params = [settings.DATASET_ID, settings.MODEL_ID]
        param_idx = 3

        if year is not None:
            conditions.append(f"data_year = ${param_idx}")
            params.append(year)
            param_idx += 1

        if month is not None:
            conditions.append(f"data_month = ${param_idx}")
            params.append(month)
            param_idx += 1

        where_clause = " AND ".join(conditions)

        sql = f"""
            SELECT
                z, x, y, patch_id, data_year, data_month,
                1 - (embedding <=> ${param_idx}) as similarity
            FROM {table_name}
            WHERE {where_clause}
            ORDER BY embedding <=> ${param_idx} ASC
            LIMIT ${param_idx + 1};
        """

        params.extend([str(query_vector), limit])

        try:
            async with db_pool.acquire() as conn:
                async with conn.transaction():
                    ef = min(max(limit * 2, limit, 40), 1000)
                    await conn.execute(f"SET LOCAL hnsw.ef_search = {ef};")

                    rows = await conn.fetch(sql, *params)

            logger.info(f"HNSW检索返回: {len(rows)} 条 (year={year}, month={month})")

            results = []
            for row in rows:
                patch_id = row['patch_id']
                patch_row = patch_id // cols_per_row
                patch_col = patch_id % cols_per_row

                col = row['x']
                tile_row = row['y']

                results.append({
                    "col": col,
                    "row": tile_row,
                    "patch_col": patch_col,
                    "patch_row": patch_row,
                    "similarity": float(row['similarity']),
                    "z": row['z'],
                    "year": row['data_year'],
                    "month": row['data_month'],
                    "key": f"{row['z']}_{row['x']}_{row['y']}_{patch_col}_{patch_row}_{row['data_year']}"
                })

            return results
        except Exception as e:
            logger.error(f"SQL检索失败: {str(e)}")
            raise

    @staticmethod
    async def search_similar_vectors_multi_years(query_vector: List[float], years: List[int],
                                                 limit_per_year: int, month: Optional[int] = None) -> List[
        Dict[str, Any]]:
        all_results = []
        for year in years:
            try:
                year_results = await DatabaseManager.search_similar_vectors(
                    query_vector, limit_per_year, year, month
                )
                all_results.extend(year_results)
            except Exception as e:
                logger.error(f"年份 {year} 搜索失败: {str(e)}")
                continue

        all_results.sort(key=lambda x: x["similarity"], reverse=True)
        return all_results

    @staticmethod
    async def search_similar_by_diff(query_diff_vector: List[float], limit: int,
                                     year_before: int, year_after: int) -> List[Dict[str, Any]]:
        """根据特征差检索相似变化"""
        if not db_pool:
            raise RuntimeError("数据库未连接")

        # 根据年份构建表名
        table_name = f"tile_patch_emdiff_{year_before}_{year_after}"

        # 检查表是否存在
        async with db_pool.acquire() as conn:
            table_exists = await conn.fetchval(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
                table_name
            )

            if not table_exists:
                logger.warning(f"特征差表 {table_name} 不存在")
                return []

        # 配置参数（与tile_patch_xiaoshan表保持一致）
        rows = 4
        cols = 4
        win = 5
        stride = 3

        sql = f"""
                SELECT
                    z, x, y, patch_id,
                    1 - (diff <=> $1) as similarity
                FROM {table_name}
                WHERE dataset_id = $2 AND model_id = $3
                ORDER BY diff <=> $1 ASC
                LIMIT $4;
            """

        try:
            async with db_pool.acquire() as conn:
                async with conn.transaction():
                    # 设置HNSW搜索参数
                    ef = min(max(limit * 2, limit, 100), 1000)
                    await conn.execute(f"SET LOCAL hnsw.ef_search = {ef};")

                    rows_result = await conn.fetch(
                        sql,
                        str(query_diff_vector),
                        settings.DATASET_ID,
                        settings.MODEL_ID,
                        limit
                    )

            logger.info(f"特征差检索返回: {len(rows_result)} 条 (表: {table_name})")

            results = []
            for row in rows_result:
                patch_id = row['patch_id']
                patch_row = patch_id // cols
                patch_col = patch_id % cols

                results.append({
                    "col": row['x'],
                    "row": row['y'],
                    "patch_col": patch_col,
                    "patch_row": patch_row,
                    "similarity": float(row['similarity']),
                    "z": row['z'],
                    "year_before": year_before,
                    "year_after": year_after,
                    "key": f"{row['z']}_{row['x']}_{row['y']}_{patch_col}_{patch_row}"
                })

            return results
        except Exception as e:
            logger.error(f"特征差检索失败: {str(e)}\n{traceback.format_exc()}")
            return []

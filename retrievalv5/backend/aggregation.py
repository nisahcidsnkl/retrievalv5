# -*- coding: utf-8 -*-
"""
目标聚合模块
"""

import logging
from typing import List, Dict, Any, Tuple

from shapely.geometry import box, mapping
from shapely.ops import unary_union

from config import TILE_PIXEL_SIZE
from utils import CoordinateConverter, UnionFind


logger = logging.getLogger(__name__)


class TargetAggregator:
    """目标聚合器"""

    @staticmethod
    def calculate_patch_center(col: int, row: int, patch_col: int, patch_row: int, zoom: int = 18) -> Tuple[float, float]:
        px_min, py_min, px_max, py_max = CoordinateConverter.get_patch_pixel_bounds(patch_col, patch_row)
        rel_center_x = (px_min + px_max) / 2
        rel_center_y = (py_min + py_max) / 2
        abs_center_x = col * TILE_PIXEL_SIZE + rel_center_x
        abs_center_y = row * TILE_PIXEL_SIZE + rel_center_y
        return abs_center_x, abs_center_y

    @staticmethod
    def calculate_aggregate_bounds(aggregate: List[Dict[str, Any]], zoom: int = 18) -> List[List[float]]:
        if not aggregate:
            return []
        all_points = []
        for patch in aggregate:
            bounds = CoordinateConverter.patch_to_latlng_bounds(
                patch["col"], patch["row"],
                patch["patch_col"], patch["patch_row"],
                zoom
            )
            all_points.extend(bounds)

        lats = [p[0] for p in all_points]
        lngs = [p[1] for p in all_points]
        return [[min(lats), min(lngs)], [min(lats), max(lngs)], [max(lats), max(lngs)], [max(lats), min(lngs)]]

    @staticmethod
    def calculate_aggregate_center(aggregate: List[Dict[str, Any]], zoom: int = 18) -> Tuple[float, float]:
        bounds = TargetAggregator.calculate_aggregate_bounds(aggregate, zoom)
        if not bounds:
            return None
        lats = [p[0] for p in bounds]
        lngs = [p[1] for p in bounds]
        return (min(lats) + max(lats)) / 2, (min(lngs) + max(lngs)) / 2

    @staticmethod
    def calculate_aggregate_info(aggregate: List[Dict[str, Any]], zoom: int = 18) -> Dict[str, Any]:
        if not aggregate:
            return {}
        bounds = TargetAggregator.calculate_aggregate_bounds(aggregate, zoom)
        center = TargetAggregator.calculate_aggregate_center(aggregate, zoom)
        max_similarity = max(patch["similarity"] for patch in aggregate)
        avg_similarity = sum(patch["similarity"] for patch in aggregate) / len(aggregate)
        return {
            "bounds": bounds,
            "center": list(center) if center else None,
            "patch_count": len(aggregate),
            "max_similarity": max_similarity,
            "avg_similarity": avg_similarity,
            "similarity": avg_similarity
        }

    @staticmethod
    def patch_to_global_pixel_bounds(patch: Dict[str, Any]) -> Tuple[float, float, float, float]:
        col, row = patch["col"], patch["row"]
        pc, pr = patch["patch_col"], patch["patch_row"]
        px_min, py_min, px_max, py_max = CoordinateConverter.get_patch_pixel_bounds(pc, pr)
        x0 = col * TILE_PIXEL_SIZE + px_min
        y0 = row * TILE_PIXEL_SIZE + py_min
        x1 = col * TILE_PIXEL_SIZE + px_max
        y1 = row * TILE_PIXEL_SIZE + py_max
        return float(x0), float(y0), float(x1), float(y1)

    @staticmethod
    def aggregate_by_touch(patches: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
        if not patches:
            return []

        rects = []
        for p in patches:
            x0, y0, x1, y1 = TargetAggregator.patch_to_global_pixel_bounds(p)
            rects.append(box(x0, y0, x1, y1))

        n = len(patches)
        uf = UnionFind(n)

        for i in range(n):
            for j in range(i + 1, n):
                if rects[i].intersects(rects[j]):
                    uf.union(i, j)

        groups: Dict[int, List[Dict[str, Any]]] = {}
        for i in range(n):
            root = uf.find(i)
            groups.setdefault(root, []).append(patches[i])

        agg = list(groups.values())
        agg.sort(key=len, reverse=True)
        return agg

    @staticmethod
    def union_geometry_geojson(aggregate: List[Dict[str, Any]], zoom: int = 18) -> Dict[str, Any]:
        if not aggregate:
            return {"type": "GeometryCollection", "geometries": []}

        polys = []
        for p in aggregate:
            x0, y0, x1, y1 = TargetAggregator.patch_to_global_pixel_bounds(p)
            polys.append(box(x0, y0, x1, y1))

        geom = unary_union(polys)
        g = mapping(geom)

        def to_lnglat(coords):
            out = []
            for (x, y) in coords:
                lat, lng = CoordinateConverter.pixel_to_latlng(x, y, zoom)
                out.append([lng, lat])
            return out

        if g["type"] == "Polygon":
            rings = []
            for ring in g["coordinates"]:
                rings.append(to_lnglat(ring))
            return {"type": "Polygon", "coordinates": rings}

        if g["type"] == "MultiPolygon":
            mp = []
            for poly in g["coordinates"]:
                rings = []
                for ring in poly:
                    rings.append(to_lnglat(ring))
                mp.append(rings)
            return {"type": "MultiPolygon", "coordinates": mp}

        return {"type": "GeometryCollection", "geometries": []}
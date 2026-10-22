"""Export the cemetery as JSON for the abstract 3D scene in scene/.

Writes scene/public/greenwood.json with:
  - boundary:  cemetery outline rings, [[x, y], ...]
  - paths:     every green_wood_healed linestring, [[x, y], ...]
  - route:     guan_route in walking order, one {r: is_retrace, p: [[x, y], ...]}
               per stop (geometries are already oriented in travel direction)
  - elevation: spot elevations within ELEVATION_RADIUS_M of the boundary,
               [x, y, z] (well beyond the fence, so terrain can extend out
               into the surrounding neighborhoods)

Coordinates are EPSG:2263 (NY State Plane feet), translated so the
boundary's bounding-box center is the origin. z is raw elevation in feet
(elevation_point's unit isn't formally confirmed, but 18–206 ft matches
Battle Hill's known ~200 ft). The scene interpolates terrain from the
elevation points at runtime, so paths are draped there, not here.

Usage:
    uv run scripts/export_scene_data.py [output.json]
"""
import json
import sys
from pathlib import Path

import psycopg

DB = "dbname=green_wood_guan host=127.0.0.1 port=5432"
ELEVATION_RADIUS_M = 2500
DEFAULT_OUT = Path(__file__).parent.parent / "scene" / "public" / "greenwood.json"


def coords(geojson_text):
    return [[round(x, 1), round(y, 1)] for x, y in json.loads(geojson_text)["coordinates"]]


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT

    with psycopg.connect(DB) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    (ST_XMin(ext) + ST_XMax(ext)) / 2,
                    (ST_YMin(ext) + ST_YMax(ext)) / 2
                FROM (
                    SELECT ST_Extent(ST_Transform(the_geog::geometry, 2263)) AS ext
                    FROM osm_greenwood_boundary
                ) e
            """)
            cx, cy = cur.fetchone()
            offset = {"cx": cx, "cy": cy}

            def shifted(sql_geom):
                return f"ST_AsGeoJSON(ST_Translate(ST_Transform({sql_geom}, 2263), -%(cx)s, -%(cy)s), 1)"

            cur.execute(
                f"""
                SELECT {shifted("ST_ExteriorRing((ST_Dump(the_geog::geometry)).geom)")}
                FROM osm_greenwood_boundary
                """,
                offset,
            )
            boundary = [coords(row[0]) for row in cur.fetchall()]

            cur.execute(
                f"SELECT {shifted('the_geog::geometry')} FROM green_wood_healed ORDER BY id",
                offset,
            )
            paths = [coords(row[0]) for row in cur.fetchall()]

            cur.execute(
                f"""
                SELECT is_retrace, {shifted('the_geog::geometry')}
                FROM guan_route
                ORDER BY stop_order
                """,
                offset,
            )
            route = [{"r": bool(r), "p": coords(g)} for r, g in cur.fetchall()]

            cur.execute(
                """
                SELECT
                    ST_X(p) - %(cx)s, ST_Y(p) - %(cy)s, e.elevation::double precision
                FROM elevation_point e
                CROSS JOIN LATERAL (SELECT ST_Transform(e.the_geog::geometry, 2263) AS p) t
                WHERE EXISTS (
                    SELECT 1 FROM osm_greenwood_boundary b
                    WHERE ST_DWithin(e.the_geog, b.the_geog, %(radius)s)
                )
                """,
                {**offset, "radius": ELEVATION_RADIUS_M},
            )
            elevation = [[round(x, 1), round(y, 1), round(z, 2)] for x, y, z in cur.fetchall()]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(
            {"boundary": boundary, "paths": paths, "route": route, "elevation": elevation},
            f,
            separators=(",", ":"),
        )

    print(
        f"wrote {len(paths)} paths, {len(route)} route stops, "
        f"{len(elevation)} elevation points to {out_path}"
    )


if __name__ == "__main__":
    main()

"""Export guan_route as a standalone SVG for opening in a GUI vector editor.

One <path> per stop_order (1,248 elements, including retraced segments as
separate overlapping paths), in EPSG:2263 (NY State Plane feet) so shapes,
lengths, and angles are geometrically accurate. Flipped and translated so
the file renders right-side-up with coordinates near the origin. Paths are
split into two groups (normal / retraced) so they're separately selectable
in the editor.

Usage:
    uv run scripts/export_guan_route_svg.py [output.svg]
"""
import sys
from pathlib import Path

import psycopg

DB = "dbname=green_wood_guan host=127.0.0.1 port=5432"
PRECISION = 2
MARGIN = 20  # feet of padding around the route in the viewBox
DEFAULT_OUT = Path(__file__).parent.parent / "website" / "route.svg"


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT

    with psycopg.connect(DB) as conn:
        with conn.cursor() as cur:
            # Bounding box of the route, in projected feet (not yet flipped —
            # ST_AsSVG flips the Y axis internally, so we translate for that
            # flip here rather than flipping the geometry ourselves)
            cur.execute("""
                SELECT ST_XMin(ext), ST_YMin(ext), ST_XMax(ext), ST_YMax(ext)
                FROM (
                    SELECT ST_Extent(ST_Transform(the_geog::geometry, 2263)) AS ext
                    FROM guan_route
                ) e
            """)
            min_x, min_y, max_x, max_y = cur.fetchone()
            width = max_x - min_x + 2 * MARGIN
            height = max_y - min_y + 2 * MARGIN
            off_x = -min_x + MARGIN
            off_y = -max_y - MARGIN

            cur.execute(
                """
                SELECT
                    stop_order,
                    is_retrace,
                    turn_instruction,
                    length_meters,
                    ST_AsSVG(
                        ST_Translate(
                            ST_Transform(the_geog::geometry, 2263),
                            %(off_x)s, %(off_y)s
                        ),
                        0, %(precision)s
                    ) AS d
                FROM guan_route
                ORDER BY stop_order
                """,
                {"off_x": off_x, "off_y": off_y, "precision": PRECISION},
            )
            rows = cur.fetchall()

    normal_paths = []
    retrace_paths = []
    for stop_order, is_retrace, turn_instruction, length_meters, d in rows:
        path = (
            f'    <path id="stop-{stop_order}" '
            f'data-stop-order="{stop_order}" '
            f'data-turn-instruction="{turn_instruction}" '
            f'data-length-meters="{length_meters}" '
            f'd="{d}" />'
        )
        (retrace_paths if is_retrace else normal_paths).append(path)

    with open(out_path, "w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write(
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {width:.2f} {height:.2f}" '
            f'width="{width:.2f}" height="{height:.2f}">\n'
        )
        f.write('  <g id="normal-segments" fill="none" stroke="#000000" stroke-width="1">\n')
        f.write("\n".join(normal_paths) + "\n")
        f.write("  </g>\n")
        f.write('  <g id="retraced-segments" fill="none" stroke="#cc0000" stroke-width="1">\n')
        f.write("\n".join(retrace_paths) + "\n")
        f.write("  </g>\n")
        f.write("</svg>\n")

    print(f"wrote {len(normal_paths)} normal + {len(retrace_paths)} retraced paths to {out_path}")
    print(f"viewBox: 0 0 {width:.1f} {height:.1f} (feet)")


if __name__ == "__main__":
    main()

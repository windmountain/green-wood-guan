set -euo pipefail

# guan_route_elevation: per-stop elevation and climb for the already-solved
# guan_route. Run this after solve_guan_route.py (guan_route must exist).
#
# Elevation is assigned once per routing vertex (nearest elevation_point,
# in feet — see task notes), not per stop, so shared vertices between
# consecutive stops get a consistent value. climb_ft is the positive part
# of the elevation change over a stop; descents don't count against it.
# elevation_point is queried directly (not the 5m-filtered
# greenwood_elevation_points) so every vertex gets a nearest match even if
# it's outside that radius.

psql -h 127.0.0.1 -p 5432 -d green_wood_guan << 'SQL'

CREATE OR REPLACE VIEW greenwood_vertex_elevation AS
SELECT
  v.id AS vertex_id,
  e.elevation::double precision AS elevation_ft
FROM greenwood_routing_vertices_pgr v
CROSS JOIN LATERAL (
  SELECT elevation
  FROM elevation_point
  ORDER BY the_geog <-> v.the_geom::geography
  LIMIT 1
) e;

CREATE OR REPLACE VIEW guan_route_elevation AS
SELECT
  g.stop_order,
  g.from_vertex,
  g.to_vertex,
  fv.elevation_ft AS from_elevation_ft,
  tv.elevation_ft AS to_elevation_ft,
  tv.elevation_ft - fv.elevation_ft AS elevation_change_ft,
  GREATEST(tv.elevation_ft - fv.elevation_ft, 0) AS climb_ft
FROM guan_route g
JOIN greenwood_vertex_elevation fv ON fv.vertex_id = g.from_vertex
JOIN greenwood_vertex_elevation tv ON tv.vertex_id = g.to_vertex
ORDER BY g.stop_order;

SQL

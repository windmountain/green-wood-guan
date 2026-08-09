set -euo pipefail

# Export guan_route as a plain, unstyled SVG: one <path> per stop_order,
# geometry only, no fill/stroke/animation. Every guan_route column is
# carried over as a data-* attribute, so a JS/CSS controller can style and
# animate it without re-querying Postgres.
#
# Coordinates are EPSG:2263 (NY State Plane feet), translated near the
# origin. ST_AsSVG flips the Y axis internally to account for SVG's
# top-left origin, so no manual flip is needed here.

psql -h 127.0.0.1 -p 5432 -d green_wood_guan -t -A -o docs/unstyled_map.svg << 'SQL'

WITH bbox AS (
  SELECT
    ST_XMin(ext) AS min_x, ST_YMin(ext) AS min_y,
    ST_XMax(ext) AS max_x, ST_YMax(ext) AS max_y
  FROM (
    SELECT ST_Extent(ST_Transform(the_geog::geometry, 2263)) AS ext
    FROM guan_route
  ) e
),
dims AS (
  SELECT
    round((max_x - min_x + 40)::numeric, 2) AS width,
    round((max_y - min_y + 40)::numeric, 2) AS height,
    (-min_x + 20) AS off_x,
    (-max_y - 20) AS off_y
  FROM bbox
),
paths AS (
  SELECT string_agg(
    '    <path id="stop-' || r.stop_order::text || '"' ||
    ' class="route-segment"' ||
    ' data-stop-order="' || r.stop_order::text || '"' ||
    ' data-from-vertex="' || r.from_vertex::text || '"' ||
    ' data-to-vertex="' || r.to_vertex::text || '"' ||
    ' data-path-id="' || r.path_id::text || '"' ||
    ' data-is-retrace="' || r.is_retrace::text || '"' ||
    ' data-length-meters="' || r.length_meters::text || '"' ||
    coalesce(' data-distance-from-start-m="' || r.distance_from_start_m::text || '"', '') ||
    ' data-bearing-start-degrees="' || r.bearing_start_degrees::text || '"' ||
    ' data-bearing-end-degrees="' || r.bearing_end_degrees::text || '"' ||
    coalesce(' data-turn-angle-degrees="' || r.turn_angle_degrees::text || '"', '') ||
    ' data-turn-instruction="' || r.turn_instruction || '"' ||
    ' d="' || ST_AsSVG(
      ST_Translate(
        ST_Transform(r.the_geog::geometry, 2263),
        d.off_x, d.off_y
      ), 0, 2
    ) || '" />',
    E'\n'
    ORDER BY r.stop_order
  ) AS svg_paths
  FROM guan_route r CROSS JOIN dims d
)
SELECT
  '<?xml version="1.0" encoding="UTF-8"?>' || E'\n' ||
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' || d.width::text || ' ' || d.height::text ||
  '" width="' || d.width::text || '" height="' || d.height::text || '">' || E'\n' ||
  p.svg_paths || E'\n' ||
  '</svg>'
FROM dims d CROSS JOIN paths p;

SQL

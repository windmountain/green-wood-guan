set -euo pipefail

# Export turn-by-turn directions for guan_route as JSON, for the website.
#
# Consecutive stops are merged into one "leg" as long as the walker doesn't
# actually turn (turn_instruction = 'continue straight') and retrace status
# doesn't change. Each leg reports the turn that leads into it, the name of
# the path being followed (the first named segment in the leg, since an
# unnamed gap can sit between two named ones), and the leg's distance.
#
# first_stop_order/last_stop_order give the range of guan_route stop_orders
# each leg covers (legs are contiguous in stop_order by construction) — the
# website uses this to match the leg to the .route-segment currently
# highlighted on the map, which carries data-stop-order.

psql -h 127.0.0.1 -p 5432 -d green_wood_guan -t -A -o docs/route-directions.json << 'SQL'

WITH with_prev AS (
  SELECT
    *,
    LAG(is_retrace) OVER (ORDER BY stop_order) AS prev_is_retrace
  FROM guan_route
),
legs AS (
  SELECT
    *,
    SUM(
      CASE
        WHEN turn_instruction <> 'continue straight'
          OR is_retrace IS DISTINCT FROM prev_is_retrace
        THEN 1 ELSE 0
      END
    ) OVER (ORDER BY stop_order) AS leg_id
  FROM with_prev
),
grouped AS (
  SELECT
    leg_id,
    (array_agg(turn_instruction ORDER BY stop_order))[1] AS instruction,
    (array_agg(name ORDER BY stop_order) FILTER (WHERE name IS NOT NULL))[1] AS name,
    bool_and(is_retrace) AS is_retrace,
    sum(length_meters) AS distance_meters,
    min(distance_from_start_m) AS cumulative_distance_meters,
    min(stop_order) AS first_stop_order,
    max(stop_order) AS last_stop_order
  FROM legs
  GROUP BY leg_id
)
SELECT json_agg(
  json_build_object(
    'step', leg_id,
    'instruction', instruction,
    'name', name,
    'distance_meters', round(distance_meters::numeric, 1),
    'cumulative_distance_meters', round(cumulative_distance_meters::numeric, 1),
    'is_retrace', is_retrace,
    'first_stop_order', first_stop_order,
    'last_stop_order', last_stop_order
  ) ORDER BY leg_id
)
FROM grouped;

SQL

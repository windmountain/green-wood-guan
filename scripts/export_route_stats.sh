set -euo pipefail

# Export summary statistics about guan_route as JSON, for the website.
#
# retrace_percent matches the "overhead" figure printed by
# solve_guan_route.py: retraced length as a percentage of the unique
# (non-retraced) network length, not of the full tour length.
#
# required_pace_min_per_mile is the constant pace needed to walk the whole
# tour (including retraced segments) in TARGET_DURATION_HOURS.

psql -h 127.0.0.1 -p 5432 -d green_wood_guan -t -A -o website/route-stats.json << 'SQL'

WITH stats AS (
  SELECT
    sum(length_meters) FILTER (WHERE NOT is_retrace) AS unique_length_m,
    sum(length_meters) FILTER (WHERE is_retrace) AS retrace_length_m,
    sum(length_meters) AS total_tour_length_m,
    count(*) FILTER (WHERE NOT is_retrace) AS unique_segments,
    count(*) FILTER (WHERE is_retrace) AS retraced_segments,
    count(*) FILTER (WHERE turn_instruction NOT IN ('start', 'continue straight')) AS turn_count,
    12 AS target_duration_hours
  FROM guan_route
)
SELECT json_build_object(
  'total_length_meters', round(total_tour_length_m::numeric, 1),
  'total_length_miles', round((total_tour_length_m / 1609.344)::numeric, 2),
  'unique_segments', unique_segments,
  'retraced_segments', retraced_segments,
  'retrace_percent', round((100.0 * retrace_length_m / unique_length_m)::numeric, 1),
  'turn_count', turn_count,
  'target_duration_hours', target_duration_hours,
  'required_pace_min_per_mile', round(
    (target_duration_hours * 60 / (total_tour_length_m / 1609.344))::numeric, 2
  )
)
FROM stats;

SQL

set -euo pipefail

# green_wood_healed: greenwood_pedestrian_network (already restricted to the
# largest contiguous piece of Green-Wood's boundary — see
# create_greenwood_pedestrian_network.sh), with a handful of bad/spurious
# edges removed, plus street sidewalks along the cemetery's perimeter
# streets that aren't cemetery paths.
#
# This is the network Guan's Route Problem is solved on.

psql -h 127.0.0.1 -p 5432 -d green_wood_guan << 'SQL'

DROP VIEW IF EXISTS green_wood_healed;

CREATE VIEW green_wood_healed AS
SELECT
  ogc_fid AS id,
  'pedestrian_network_flow' AS source,
  the_geog
FROM greenwood_pedestrian_network
WHERE ogc_fid NOT IN (
  -- sidewalks along 7 Ave, 23 St, 20 St, and McDonald Ave (perimeter
  -- streets, not cemetery paths), found by proximity to street_centerline
  51668, 51964, 52067, 53120, 53121, 53233, 55908, 55909, 56286,
  -- additional spurious/unwanted edges
  55878, 50744,
  53117, 53299, 53202, 52898, 52923, 53091, 55771, 51926, 51984, 51892,
  54755, 53129, 53131, 52954, 52228, 52229, 50564, 50723, 46418, 45512
);

SQL

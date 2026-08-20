set -euo pipefail

# greenwood_pedestrian_network: the subset of the citywide pedestrian network
# (pedestrian_network_flow) that falls inside Green-Wood Cemetery's boundary.
# Used instead of osm_greenwood_path (raw OSM) because it's topologically
# connected — see the connectivity comparison in project notes.
#
# osm_greenwood_boundary is a multipolygon with two disjoint pieces: the
# cemetery itself (~470 acres) and a separate ~6-acre parcel a couple
# hundred feet away with no path connection between them. Only the largest
# piece is used — the smaller one and its paths are dropped entirely,
# rather than trying to bridge the two.

psql -h 127.0.0.1 -p 5432 -d green_wood_guan << 'SQL'

DROP TABLE IF EXISTS greenwood_pedestrian_network CASCADE;

CREATE TABLE greenwood_pedestrian_network AS
WITH boundary_pieces AS (
  SELECT (ST_Dump(the_geog::geometry)).geom AS geom
  FROM osm_greenwood_boundary
),
largest_boundary_piece AS (
  SELECT geom FROM boundary_pieces ORDER BY ST_Area(geom::geography) DESC LIMIT 1
)
SELECT p.*
FROM pedestrian_network_flow p
JOIN largest_boundary_piece b ON ST_Intersects(p.the_geog::geometry, b.geom);

CREATE INDEX greenwood_pedestrian_network_geog_idx ON greenwood_pedestrian_network USING gist(the_geog);

SQL

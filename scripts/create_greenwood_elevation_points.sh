set -euo pipefail

# greenwood_elevation_points: the subset of elevation_point (citywide spot
# elevations at building footprint corners) that falls within 5 meters of
# the Green-Wood path network (green_wood_healed) — a proxy for "points
# that affect walking elevation," since the source data isn't a dense
# ground-elevation raster.
#
# NOTE: elevation_point's elevation column's unit (feet vs meters) is
# unconfirmed — don't use it for grade/slope math until that's settled.

psql -h 127.0.0.1 -p 5432 -d green_wood_guan << 'SQL'

DROP TABLE IF EXISTS greenwood_elevation_points CASCADE;

CREATE TABLE greenwood_elevation_points AS
SELECT
  e.ogc_fid AS id,
  e.elevation::double precision AS elevation,
  e.the_geog
FROM elevation_point e
WHERE EXISTS (
  SELECT 1
  FROM green_wood_healed p
  WHERE ST_DWithin(e.the_geog, p.the_geog, 5)
);

CREATE INDEX greenwood_elevation_points_geog_idx ON greenwood_elevation_points USING gist(the_geog);

SQL

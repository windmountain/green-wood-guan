set -euo pipefail

# Build a routable network from green_wood_healed for Guan's Route Problem.
# pgRouting needs geometry (not geography).

psql -h 127.0.0.1 -p 5432 -d green_wood_guan << 'SQL'

DROP TABLE IF EXISTS greenwood_routing_vertices_pgr CASCADE;
DROP TABLE IF EXISTS greenwood_routing CASCADE;

CREATE TABLE greenwood_routing AS
SELECT
  id,
  the_geog::geometry AS the_geom
FROM green_wood_healed;

ALTER TABLE greenwood_routing ADD COLUMN source INTEGER;
ALTER TABLE greenwood_routing ADD COLUMN target INTEGER;

-- Cost is the length in meters
ALTER TABLE greenwood_routing ADD COLUMN cost DOUBLE PRECISION;
UPDATE greenwood_routing SET cost = ST_Length(the_geom::geography);

-- Name each edge from its nearest matching osm_greenwood_path segment
-- (pedestrian_network_flow doesn't carry names, OSM does). A match requires
-- the OSM segment to run within 8m of the edge and within 20 degrees of its
-- bearing (a path and its reverse direction count as the same), so a
-- crossing path's name isn't grabbed by mistake.
ALTER TABLE greenwood_routing ADD COLUMN name TEXT;

WITH osm_named AS (
  SELECT id AS osm_id, name, the_geog
  FROM osm_greenwood_path
  WHERE name IS NOT NULL
),
routing_bearings AS (
  SELECT
    r.id,
    r.the_geom,
    degrees(ST_Azimuth(
      ST_Transform(ST_StartPoint(r.the_geom), 2263),
      ST_Transform(ST_EndPoint(r.the_geom), 2263)
    )) AS bearing
  FROM greenwood_routing r
),
osm_bearings AS (
  SELECT
    o.osm_id,
    o.name,
    o.the_geog,
    degrees(ST_Azimuth(
      ST_Transform(ST_StartPoint(o.the_geog::geometry), 2263),
      ST_Transform(ST_EndPoint(o.the_geog::geometry), 2263)
    )) AS bearing
  FROM osm_named o
),
matches AS (
  SELECT DISTINCT ON (r.id)
    r.id,
    o.name
  FROM routing_bearings r
  JOIN osm_bearings o ON ST_DWithin(r.the_geom::geography, o.the_geog, 8)
  WHERE LEAST(
    abs(r.bearing - o.bearing),
    abs(r.bearing - o.bearing - 180),
    abs(r.bearing - o.bearing + 180)
  ) < 20
  ORDER BY r.id, ST_Distance(r.the_geom::geography, o.the_geog)
)
UPDATE greenwood_routing r
SET name = m.name
FROM matches m
WHERE m.id = r.id;

CREATE INDEX greenwood_routing_geom_idx ON greenwood_routing USING gist(the_geom);

-- Build topology with a 1-meter tolerance for snapping endpoints
SELECT pgr_createTopology(
  'greenwood_routing',
  0.00001,  -- ~1 meter tolerance in degrees
  'the_geom',
  'id'
);

SQL

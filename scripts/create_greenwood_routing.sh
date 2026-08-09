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

CREATE INDEX greenwood_routing_geom_idx ON greenwood_routing USING gist(the_geom);

-- Build topology with a 1-meter tolerance for snapping endpoints
SELECT pgr_createTopology(
  'greenwood_routing',
  0.00001,  -- ~1 meter tolerance in degrees
  'the_geom',
  'id'
);

SQL

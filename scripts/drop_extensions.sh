set -euo pipefail


psql -h 127.0.0.1 -p 5432 -d green_wood_guan << SQL
  DROP EXTENSION IF EXISTS postgis CASCADE;
  -- DROP EXTENSION IF EXISTS pgrouting CASCADE; -- not working rn
SQL

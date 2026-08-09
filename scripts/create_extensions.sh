set -euo pipefail


psql -h 127.0.0.1 -p 5432 -d green_wood_guan << SQL
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS pgrouting; -- disabling before moving off devenv postgress for Postgres.app
SQL

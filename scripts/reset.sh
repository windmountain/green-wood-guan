set -euo pipefail

psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists borough cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists sidewalk cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists sidewalk_centerline cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists street_centerline cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists pedestrian_network_flow cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists greenwood_boundary cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists greenwood_path cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists greenwood_pedestrian_network cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop view if exists green_wood_healed cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists greenwood_routing cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists greenwood_routing_vertices_pgr cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists guan_route_order cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists guan_route cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists elevation_point cascade;"
psql -h 127.0.0.1 -p 5432 -d green_wood_guan --command "drop table if exists greenwood_elevation_points cascade;"

. $(dirname "$0")/drop_extensions.sh

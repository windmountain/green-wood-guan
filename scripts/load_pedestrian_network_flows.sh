set -euo pipefail

# pedestrian_network_flow

unzip -o "data/pedestrian-network-flows.zip" -d "data/"

ogr2ogr -f "PostgreSQL" \
  PG:"dbname=green_wood_guan host=127.0.0.1 port=5432" \
  "data/NYC_pednetwork_estimates_counts_2018-2019.geojson" \
  -nln pedestrian_network_flow \
  -s_srs "EPSG:6538" \
  -t_srs "EPSG:4326" \
  -lco GEOM_TYPE=geography \
  -lco OVERWRITE=YES;

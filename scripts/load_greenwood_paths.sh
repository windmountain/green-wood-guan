# greenwood_path
ogr2ogr -f "PostgreSQL" \
  PG:"dbname=green_wood_guan host=127.0.0.1 port=5432" \
  "data/greenwood-paths.geojson" \
  -nln greenwood_path \
  -t_srs "EPSG:4326" \
  -lco GEOM_TYPE=geography \
  -lco OVERWRITE=YES;

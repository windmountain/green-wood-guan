# sidewalk_centerline
ogr2ogr -f "PostgreSQL" \
  PG:"dbname=green_wood_guan host=127.0.0.1 port=5432" \
  "data/sidewalk-lines.geojson" \
  -nln sidewalk_centerline \
  -t_srs "EPSG:4326" \
  -lco GEOM_TYPE=geography \
  -lco OVERWRITE=YES \
  -lco COLUMN_TYPES="st_width:NUMERIC";

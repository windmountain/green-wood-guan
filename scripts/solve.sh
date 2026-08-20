set -euo pipefail

uv run $(dirname "$0")/solve_guan_route.py
. $(dirname "$0")/enrich_guan_route_elevation.sh
. $(dirname "$0")/export_route_stats.sh
. $(dirname "$0")/export_unstyled_map.sh
uv run $(dirname "$0")/export_guan_route_svg.py
uv run $(dirname "$0")/export_guan_route_elm.py

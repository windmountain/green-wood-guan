set -euo pipefail

. $(dirname "$0")/create_database.sh
. $(dirname "$0")/create_extensions.sh
. $(dirname "$0")/load_boroughs.sh
. $(dirname "$0")/load_sidewalk_centerlines.sh
. $(dirname "$0")/load_sidewalks.sh
. $(dirname "$0")/load_street_centerlines.sh
. $(dirname "$0")/load_pedestrian_network_flows.sh
. $(dirname "$0")/load_greenwood_boundary.sh
. $(dirname "$0")/load_greenwood_paths.sh
. $(dirname "$0")/create_greenwood_pedestrian_network.sh
. $(dirname "$0")/create_green_wood_healed.sh
. $(dirname "$0")/create_greenwood_routing.sh

"""Solve Guan's Route Problem (Chinese Postman / route inspection problem) on
greenwood_routing: find the shortest closed walk that covers every edge at
least once.

Algorithm:
  1. Load the graph. Require it to be connected (a single closed tour can't
     exist otherwise).
  2. Find odd-degree vertices (a graph has an Eulerian circuit iff every
     vertex has even degree).
  3. Compute shortest-path distances between all pairs of odd vertices, and
     find the minimum-weight perfect matching over them.
  4. Duplicate each matched pair's shortest path, making every vertex even.
  5. Find an Eulerian circuit (Hierholzer's algorithm, via networkx) over the
     resulting multigraph. That circuit is the route.

Writes results to Postgres: guan_route_order (the walk order, as
source/target vertex ids) and guan_route (joined back to greenwood_routing
for geometry, oriented in the direction of travel).

Usage:
    uv run scripts/solve_guan_route.py
"""
import itertools

import networkx as nx
import psycopg

DB = "dbname=green_wood_guan host=127.0.0.1 port=5432"

# Hard-coded start/end point for the tour (a closed walk can start anywhere,
# so this just picks which point that is) — whatever vertex on the network
# is closest to this coordinate.
START_LON = -73.99565538729414
START_LAT = 40.6590286493774


def load_graph(cur):
    cur.execute("SELECT id, source, target, cost FROM greenwood_routing")
    G = nx.MultiGraph()
    edges = cur.fetchall()
    for edge_id, source, target, cost in edges:
        G.add_edge(source, target, key=edge_id, path_id=edge_id, weight=cost)
    return G, edges


def find_start_vertex(cur, lon, lat):
    cur.execute(
        """
        SELECT id
        FROM greenwood_routing_vertices_pgr
        ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geometry
        LIMIT 1
        """,
        (lon, lat),
    )
    (vertex_id,) = cur.fetchone()
    return vertex_id


def find_matching(G, odd):
    """Minimum-weight perfect matching over the odd-degree vertices, using
    shortest-path distance between each pair as the matching weight."""
    node_path = {}
    K = nx.Graph()
    for u in odd:
        lengths, paths = nx.single_source_dijkstra(G, u, weight="weight")
        for v in odd:
            if v <= u:
                continue
            node_path[(u, v)] = paths[v]
            node_path[(v, u)] = list(reversed(paths[v]))
            K.add_edge(u, v, weight=-lengths[v])
    matching = nx.max_weight_matching(K, maxcardinality=True)
    return matching, node_path


def augment_graph(G, matching, node_path):
    """Duplicate the shortest path for each matched pair, so every vertex
    ends up with even degree."""
    G_aug = G.copy()
    counter = itertools.count(1)
    retrace_path_ids = []
    retrace_length = 0.0
    for u, v in matching:
        path = node_path[(u, v)]
        for a, b in zip(path, path[1:]):
            edge_data = G.get_edge_data(a, b)
            best_key = min(edge_data, key=lambda k: edge_data[k]["weight"])
            data = edge_data[best_key]
            G_aug.add_edge(a, b, key=f"retrace-{next(counter)}", **data, is_retrace=True)
            retrace_path_ids.append(data["path_id"])
            retrace_length += data["weight"]
    return G_aug, retrace_path_ids, retrace_length


def write_results(cur, circuit, G_aug):
    cur.execute("DROP TABLE IF EXISTS guan_route_order CASCADE")
    cur.execute("""
        CREATE TABLE guan_route_order (
            stop_order   INTEGER PRIMARY KEY,
            from_vertex  INTEGER NOT NULL,
            to_vertex    INTEGER NOT NULL,
            path_id      INTEGER NOT NULL,
            is_retrace   BOOLEAN NOT NULL
        )
    """)

    seen = set()
    rows = []
    for i, (u, v, key) in enumerate(circuit, start=1):
        data = G_aug.get_edge_data(u, v, key)
        path_id = data["path_id"]
        is_retrace = path_id in seen
        seen.add(path_id)
        rows.append((i, u, v, path_id, is_retrace))

    cur.executemany(
        "INSERT INTO guan_route_order (stop_order, from_vertex, to_vertex, path_id, is_retrace) "
        "VALUES (%s, %s, %s, %s, %s)",
        rows,
    )

    cur.execute("""
        DROP TABLE IF EXISTS guan_route CASCADE;
        CREATE TABLE guan_route AS
        WITH oriented AS (
            SELECT
                o.stop_order,
                o.from_vertex,
                o.to_vertex,
                o.path_id,
                o.is_retrace,
                r.name,
                r.cost AS length_meters,
                CASE
                    WHEN r.source = o.from_vertex THEN r.the_geom
                    ELSE ST_Reverse(r.the_geom)
                END AS the_geom
            FROM guan_route_order o
            JOIN greenwood_routing r ON r.id = o.path_id
        ),
        -- bearings computed in a local projected CRS (feet, doesn't matter for
        -- an angle) since ST_Azimuth needs planar, not geographic, coordinates
        bearings AS (
            SELECT
                *,
                degrees(ST_Azimuth(
                    ST_Transform(ST_PointN(the_geom, 1), 2263),
                    ST_Transform(ST_PointN(the_geom, 2), 2263)
                )) AS bearing_start_degrees,
                degrees(ST_Azimuth(
                    ST_Transform(ST_PointN(the_geom, ST_NPoints(the_geom) - 1), 2263),
                    ST_Transform(ST_PointN(the_geom, ST_NPoints(the_geom)), 2263)
                )) AS bearing_end_degrees
            FROM oriented
        ),
        turns AS (
            SELECT
                *,
                bearing_start_degrees - LAG(bearing_end_degrees) OVER (ORDER BY stop_order)
                    AS raw_turn_degrees
            FROM bearings
        )
        SELECT
            stop_order,
            from_vertex,
            to_vertex,
            path_id,
            is_retrace,
            name,
            round(length_meters::numeric, 1) AS length_meters,
            round(
                (SUM(length_meters) OVER (ORDER BY stop_order ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING))::numeric,
                1
            ) AS distance_from_start_m,
            round(bearing_start_degrees::numeric, 1) AS bearing_start_degrees,
            round(bearing_end_degrees::numeric, 1) AS bearing_end_degrees,
            round((raw_turn_degrees - 360.0 * floor((raw_turn_degrees + 180.0) / 360.0))::numeric, 1)
                AS turn_angle_degrees,
            CASE
                WHEN raw_turn_degrees IS NULL THEN 'start'
                WHEN abs(raw_turn_degrees - 360.0 * floor((raw_turn_degrees + 180.0) / 360.0)) < 15 THEN 'continue straight'
                WHEN (raw_turn_degrees - 360.0 * floor((raw_turn_degrees + 180.0) / 360.0)) BETWEEN 15 AND 45 THEN 'slight right'
                WHEN (raw_turn_degrees - 360.0 * floor((raw_turn_degrees + 180.0) / 360.0)) BETWEEN 45 AND 135 THEN 'turn right'
                WHEN (raw_turn_degrees - 360.0 * floor((raw_turn_degrees + 180.0) / 360.0)) > 135 THEN 'sharp right'
                WHEN (raw_turn_degrees - 360.0 * floor((raw_turn_degrees + 180.0) / 360.0)) BETWEEN -45 AND -15 THEN 'slight left'
                WHEN (raw_turn_degrees - 360.0 * floor((raw_turn_degrees + 180.0) / 360.0)) BETWEEN -135 AND -45 THEN 'turn left'
                ELSE 'sharp left'
            END AS turn_instruction,
            ST_StartPoint(the_geom)::geography AS start_point,
            ST_EndPoint(the_geom)::geography AS end_point,
            the_geom::geography AS the_geog
        FROM turns
        ORDER BY stop_order;

        ALTER TABLE guan_route ADD PRIMARY KEY (stop_order);
        CREATE INDEX guan_route_geog_idx ON guan_route USING gist(the_geog);
    """)
    return rows


def main():
    with psycopg.connect(DB) as conn:
        with conn.cursor() as cur:
            G, edges = load_graph(cur)

            if not nx.is_connected(G):
                components = list(nx.connected_components(G))
                raise SystemExit(
                    f"greenwood_routing is not connected ({len(components)} components) — "
                    "can't find a single closed tour. Fix the graph before solving."
                )

            total_length = sum(cost for _, _, _, cost in edges)
            odd = [v for v, d in G.degree() if d % 2 == 1]
            print(f"{len(edges)} edges, {G.number_of_nodes()} vertices, "
                  f"{total_length:.0f}m total")
            print(f"{len(odd)} odd-degree vertices")

            if odd:
                matching, node_path = find_matching(G, odd)
                G_aug, retrace_path_ids, retrace_length = augment_graph(G, matching, node_path)
                print(f"{len(matching)} matched pairs, "
                      f"{len(retrace_path_ids)} edges retraced, "
                      f"{retrace_length:.0f}m of retracing added "
                      f"({100 * retrace_length / total_length:.1f}% overhead)")
            else:
                G_aug = G
                print("graph is already Eulerian, no retracing needed")

            start_vertex = find_start_vertex(cur, START_LON, START_LAT)
            print(f"start/end vertex: {start_vertex}")

            assert nx.is_eulerian(G_aug)
            circuit = list(nx.eulerian_circuit(G_aug, source=start_vertex, keys=True))

            rows = write_results(cur, circuit, G_aug)
            conn.commit()

            print(f"\nwrote {len(rows)} stops to guan_route "
                  f"({total_length + (retrace_length if odd else 0):.0f}m closed tour)")


if __name__ == "__main__":
    main()

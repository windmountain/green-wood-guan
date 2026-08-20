# Green-Wood Guan

Finding the shortest walking route that covers every path in Green-Wood
Cemetery (Brooklyn), at least once, on foot — Guan's Route Problem (also
called the route inspection problem), after Mei-Ko Guan, who first posed
it in 1962.

This repo is a shell carried over from a previous, similar project (McTrot,
a TSP over McDonald's locations in Manhattan). It keeps the general
pipeline — fetch data, load into Postgres/PostGIS, design a map in QGIS,
route along a network with pgRouting — and drops everything specific to
that earlier problem. The cemetery path network and the solving approach
itself still need to be built.

This repo contains tools for:
- downloading geospatial layers from NYC Open Data
- massaging layers into Postgres views
- designing a map in QGIS
- building a routable graph and solving Guan's Route Problem (find
  the odd-degree vertices, compute a minimum-weight matching between them,
  find an Eulerian circuit)
- exporting the solved route as JSON stats, SVG, and an Elm data module

This repository manages its external dependencies (gdal, postgres, jq, etc.) with [devenv.sh](https://devenv.sh).

# Fetching data

The data dependencies of this map are listed in datapackage.json. Datapackage is a [specification](https://datapackage.org/standard/data-package/) for documenting where data came from, how it's licensed, etc.

Currently this is just the pedestrian network (sidewalk polygons, sidewalk
lines, street centerlines) and borough boundaries, kept over from the
previous project as a starting base map layer.

For some of these dependencies, you will need an account with NYC Open Data. Follow these steps:
- Copy the .env.example file to a new file named .env.
- Visit [their sign up page](https://data.cityofnewyork.us/signup) and sign up.
- Verify your email address.
- Go to [Developer Settings](https://data.cityofnewyork.us/profile/edit/developer_settings).
- Click the "Create new API Key" button. Give it a name.
- Fill in your .env file with your new API Key ID and Api Key Secret.

Once set up, fetch the data by running the fetch.py Python script.

# Postgres and QGIS

Much of this project is concerned with loading data into Postgres and bringing it into QGIS for designing an actual map. Loading data directly into QGIS makes things too sluggish.

~~Start Postgres with `devenv up`~~ Running Postgres from devenv is disabled because the pgrouting extension there is busted. Try [Postgres.app](https://postgresapp.com) if you're on a Mac. If you're not on a Mac, there are [many other options](https://www.postgresql.org/download/). The main thing is you want a local server running on the default port.

Run `devenv shell` and then `./scripts/load.sh` to set up the green_wood_guan database and import data from data/.

Download and open [QGIS](https://qgis.org), create a new project, open the Data Source Manager window and a new Postgres connection with these details:

- name: green_wood_guan
- host: 127.0.0.1
- port: 5432
- database: green_wood_guan

Choose tables to add into the project. Each table makes a layer on the map, with settings for how it's drawn and labeled.

Python dependencies (Jupyter, psycopg, pandas, numpy, matplotlib) are declared in `pyproject.toml`. To install them:

```
uv sync
```

# Solving the route

`./scripts/load.sh` (above) loads raw data and builds the routable graph, but
stops short of solving anything. `./scripts/solve.sh` picks up from there:

- `solve_guan_route.py` — solves Guan's Route Problem over the graph built by
  `load.sh`, writing the result to the `guan_route_order`/`guan_route` tables
- `enrich_guan_route_elevation.sh` — adds per-stop elevation and climb to the
  now-solved route (`guan_route_elevation` view); run after
  `solve_guan_route.py`, since it requires `guan_route` to already exist
- `export_route_stats.sh` — writes summary stats (length, retrace percent,
  turn count, required pace, total climb) to `docs/route-stats.json`
- `export_unstyled_map.sh` — writes the route as a plain SVG to
  `docs/unstyled_map.svg`, for a JS/CSS controller to style and animate
- `export_guan_route_svg.py` — writes the route as a standalone SVG for
  opening in a GUI vector editor
- `export_guan_route_elm.py` — writes the route (with elevation) as a static
  Elm data module, for the 3D route view

Run `uv sync` first (for `solve_guan_route.py`'s `networkx`/`psycopg`
dependencies), then `./scripts/solve.sh`.

**Not yet connected to the site:** `elm/` is a complete Elm app (orbit
camera, walk animation, elevation exaggeration) that consumes the
generated `GuanRoute.elm` module, but nothing compiles it (no `elm make`
step anywhere) and no page in `docs/` embeds the result. `./scripts/solve.sh`
keeps `GuanRoute.elm` up to date; turning that into a working 3D view on
the site still needs a build step (e.g. a `scripts/build_elm.sh` producing
`docs/js/elm.js`) and a mount point in an HTML page.

# A note on AI

This GIS endeavor began in 2024 with the usual kind of Googling around for stuff, on a previous problem (McTrot). In 2026 I started using Claude pretty heavily to build on what's here, including gutting and reshaping this repo for a new problem.

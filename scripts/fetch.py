#!/usr/bin/env python3
"""Fetch data resources declared in datapackage.json.

Supports two NYC Open Data API versions:
  - SODA2 (/resource/): used for small datasets, paginated at 1000 rows
  - SODA3 (/api/v3/):   used for large datasets, requires API key from .env

Resources without an API endpoint are skipped with a note.

Usage:
    python scripts/fetch.py             # download missing files
    python scripts/fetch.py --force     # re-download everything
    python scripts/fetch.py --check     # verify hashes of existing files
    python scripts/fetch.py --delete    # delete downloaded files (manual-source files kept)
"""
import base64
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

PACKAGE_DIR = Path(__file__).parent.parent
DATAPACKAGE = PACKAGE_DIR / "datapackage.json"
ENV_FILE = PACKAGE_DIR / ".env"
PAGE_SIZE = 1000


def load_env():
    """Load .env file into os.environ if it exists."""
    if not ENV_FILE.exists():
        return
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def is_nyc_opendata_soda2(api_url):
    return "data.cityofnewyork.us/resource/" in api_url


def is_nyc_opendata_soda3(api_url):
    return "data.cityofnewyork.us/api/v3/" in api_url


def is_overpass(api_url):
    return "overpass-api.de/api/interpreter" in api_url


def fetch_overpass(api_url, query):
    """POST an Overpass QL query and return the parsed Overpass JSON."""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(api_url, data=data)
    req.add_header("User-Agent", "green-wood-guan-fetch/0.1")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def overpass_ways_to_geojson(elements):
    """Convert Overpass `way` elements (with `out geom`) into LineString features."""
    features = []
    for el in elements:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        coords = [[pt["lon"], pt["lat"]] for pt in el["geometry"]]
        features.append({
            "type": "Feature",
            "properties": {"id": el.get("id"), **el.get("tags", {})},
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    return {"type": "FeatureCollection", "features": features}


def _assemble_rings(members):
    """Chain member way geometries sharing endpoints into closed (role, ring) pairs."""
    segments = [
        (m.get("role", "outer"), [(pt["lon"], pt["lat"]) for pt in m["geometry"]])
        for m in members
        if m.get("type") == "way" and "geometry" in m
    ]
    rings, remaining = [], []
    for role, coords in segments:
        (rings if coords[0] == coords[-1] else remaining).append((role, coords))

    while remaining:
        role, chain = remaining.pop(0)
        changed = True
        while chain[0] != chain[-1] and changed:
            changed = False
            for i, (_, coords) in enumerate(remaining):
                if coords[0] == chain[-1]:
                    chain = chain + coords[1:]
                elif coords[-1] == chain[-1]:
                    chain = chain + list(reversed(coords))[1:]
                elif coords[-1] == chain[0]:
                    chain = coords[:-1] + chain
                elif coords[0] == chain[0]:
                    chain = list(reversed(coords))[:-1] + chain
                else:
                    continue
                remaining.pop(i)
                changed = True
                break
        rings.append((role, chain))
    return rings


def _point_in_ring(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def overpass_relation_to_geojson(elements):
    """Convert a single Overpass `relation` element (multipolygon, with `out geom`
    on its members) into one Polygon/MultiPolygon feature."""
    relation = next(el for el in elements if el.get("type") == "relation")
    rings = _assemble_rings(relation["members"])
    outers = [r for role, r in rings if role == "outer"]
    inners = [r for role, r in rings if role == "inner"]

    polygons = []
    for outer in outers:
        holes = [inner for inner in inners if _point_in_ring(inner[0], outer)]
        polygons.append([[list(pt) for pt in outer]] + [[list(pt) for pt in h] for h in holes])

    geometry = (
        {"type": "Polygon", "coordinates": polygons[0]}
        if len(polygons) == 1
        else {"type": "MultiPolygon", "coordinates": polygons}
    )
    feature = {
        "type": "Feature",
        "properties": {"id": relation.get("id"), **relation.get("tags", {})},
        "geometry": geometry,
    }
    return {"type": "FeatureCollection", "features": [feature]}


def fetch_overpass_geojson(api_url, query, kind):
    print(f"    querying Overpass...", end="", flush=True)
    result = fetch_overpass(api_url, query)
    elements = result.get("elements", [])
    print(f" {len(elements)} elements")
    if kind == "polygon":
        return overpass_relation_to_geojson(elements)
    return overpass_ways_to_geojson(elements)


def soda3_auth_header():
    """Build HTTP Basic auth header from .env credentials."""
    key_id = os.environ.get("NYC_OPEN_DATA_API_KEY_ID", "")
    key_secret = os.environ.get("NYC_OPEN_DATA_API_KEY_SECRET", "")
    if not key_id or not key_secret:
        return None
    encoded = base64.b64encode(f"{key_id}:{key_secret}".encode()).decode()
    return f"Basic {encoded}"


def sha256_file(filepath):
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_url(url, auth=None):
    """Fetch a URL, optionally with an auth header."""
    req = urllib.request.Request(url)
    if auth:
        req.add_header("Authorization", auth)
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def soda3_to_soda2_count_url(api_url):
    """Derive a SODA2 count URL from a SODA3 endpoint.

    SODA3's $select=count(*) doesn't work as expected, so we use
    the SODA2 endpoint (no auth needed) just for the count query.
    e.g. /api/v3/views/ABC/query.geojson -> /resource/ABC.json?$select=count(*)
    """
    # Extract the dataset ID from the SODA3 URL
    # /api/v3/views/{id}/query.geojson -> {id}
    parts = api_url.split("/")
    view_idx = parts.index("views")
    dataset_id = parts[view_idx + 1]
    base = api_url.split("/api/v3/")[0]
    return f"{base}/resource/{dataset_id}.json?$select=count(*)"


def fetch_soda3_geojson(api_url, auth):
    """Fetch all features from a SODA3 GeoJSON endpoint."""
    sep = "&" if "?" in api_url else "?"

    # Get row count via SODA2 (no auth needed, reliable count)
    count_url = soda3_to_soda2_count_url(api_url)
    print(f"    counting rows...", end="", flush=True)
    data = json.loads(fetch_url(count_url))
    count = int(data[0]["count"])
    print(f" {count}")

    # Fetch all rows via SODA3 (auth required) in one request
    fetch_url_str = f"{api_url}{sep}$limit={count}"
    print(f"    downloading {count} features...", end="", flush=True)
    raw = fetch_url(fetch_url_str, auth)
    data = json.loads(raw)
    print(f" done")

    return data


def fetch_soda2_geojson(api_url):
    """Fetch all features from a SODA2 GeoJSON endpoint, paginating."""
    all_features = []
    offset = 0
    sep = "&" if "?" in api_url else "?"

    while True:
        page_url = f"{api_url}{sep}$limit={PAGE_SIZE}&$offset={offset}"
        print(f"    page at offset {offset}...", end="", flush=True)
        data = json.loads(fetch_url(page_url))

        features = data.get("features", [])
        all_features.extend(features)
        print(f" {len(features)} features")

        if len(features) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    return {"type": "FeatureCollection", "features": all_features}


def verify_hash(filepath, expected_hash):
    if not expected_hash:
        return
    expected = expected_hash.removeprefix("sha256:")
    actual = sha256_file(filepath)
    if actual == expected:
        print(f"    hash: OK")
    else:
        print(f"    hash: CHANGED (upstream data is newer than recorded)")
        print(f"      recorded: sha256:{expected}")
        print(f"      actual:   sha256:{actual}")


def fetch_resource(resource, force=False):
    name = resource["name"]
    filepath = PACKAGE_DIR / resource["path"]
    sources = resource.get("sources", [])
    source = sources[0] if sources else {}
    api_url = source.get("api")
    overpass_query = source.get("query")

    if not api_url:
        hint = source.get("path", source.get("title", ""))
        if filepath.exists():
            print(f"  {name}: exists (no API endpoint — manual source)")
        else:
            print(f"  {name}: SKIP — no API endpoint, fetch manually")
            if hint:
                print(f"    source: {hint}")
        return filepath.exists()

    if filepath.exists() and not force:
        print(f"  {name}: exists (use --force to re-download)")
        verify_hash(filepath, resource.get("hash"))
        return True

    filepath.parent.mkdir(parents=True, exist_ok=True)
    print(f"  {name}: downloading from {api_url}")

    try:
        if overpass_query:
            data = fetch_overpass_geojson(api_url, overpass_query, resource.get("overpass_kind"))
        elif is_nyc_opendata_soda3(api_url):
            auth = soda3_auth_header()
            if not auth:
                print(f"    FAILED — SODA3 endpoint requires API key in .env")
                return False
            data = fetch_soda3_geojson(api_url, auth)
        elif is_nyc_opendata_soda2(api_url):
            data = fetch_soda2_geojson(api_url)
        else:
            # Direct download (e.g., CUGIR)
            print(f"    downloading...", end="", flush=True)
            raw = fetch_url(api_url)
            with open(filepath, "wb") as f:
                f.write(raw)
            print(f" done")
            verify_hash(filepath, resource.get("hash"))
            return True
    except Exception as e:
        print(f"    FAILED — {e}")
        return False

    with open(filepath, "w") as f:
        json.dump(data, f)

    count = len(data.get("features", []))
    print(f"    wrote {count} features to {resource['path']}")
    verify_hash(filepath, resource.get("hash"))
    return True


def collect_hash_changes(resources):
    """Compare actual file hashes to recorded hashes in datapackage.json."""
    changes = []
    for r in resources:
        filepath = PACKAGE_DIR / r["path"]
        if not filepath.exists():
            continue
        actual = f"sha256:{sha256_file(filepath)}"
        recorded = r.get("hash", "")
        if recorded and actual == recorded:
            continue
        changes.append((r["name"], recorded or None, actual))
    return changes


def print_hash_summary(changes):
    """Print hash changes needed in datapackage.json."""
    if not changes:
        print("\nAll hashes in datapackage.json are up to date.")
        return
    print(f"\nHash updates for datapackage.json:")
    for name, old, new in changes:
        if old:
            print(f"  {name}:")
            print(f"    - {old}")
            print(f"    + {new}")
        else:
            print(f"  {name}: (no hash recorded)")
            print(f"    + {new}")


def delete_only(resources):
    """Delete downloaded files for resources with an API endpoint.

    Resources without an API endpoint (manual sources) are left alone —
    there's nothing to re-fetch for them.
    """
    for r in resources:
        name = r["name"]
        filepath = PACKAGE_DIR / r["path"]
        sources = r.get("sources", [])
        source = sources[0] if sources else {}

        if not source.get("api"):
            print(f"  {name}: kept (no API endpoint — manual source)")
            continue

        if not filepath.exists():
            print(f"  {name}: not downloaded")
            continue

        filepath.unlink()
        print(f"  {name}: deleted {r['path']}")


def check_only(resources):
    for r in resources:
        name = r["name"]
        filepath = PACKAGE_DIR / r["path"]
        if not filepath.exists():
            print(f"  {name}: MISSING")
            continue
        expected = r.get("hash")
        if not expected:
            print(f"  {name}: no hash recorded")
            continue
        actual = sha256_file(filepath)
        if actual == expected.removeprefix("sha256:"):
            print(f"  {name}: OK")
        else:
            print(f"  {name}: CHANGED")


def main():
    load_env()

    with open(DATAPACKAGE) as f:
        package = json.load(f)

    resources = package["resources"]
    force = "--force" in sys.argv

    print(f"{package['title']}")
    print(f"{len(resources)} resources\n")

    if "--check" in sys.argv:
        check_only(resources)
        print_hash_summary(collect_hash_changes(resources))
        return

    if "--delete" in sys.argv:
        delete_only(resources)
        return

    ok = 0
    skipped = 0
    for r in resources:
        if fetch_resource(r, force=force):
            ok += 1
        else:
            skipped += 1

    print(f"\nDone: {ok} OK, {skipped} need manual action")
    print_hash_summary(collect_hash_changes(resources))


if __name__ == "__main__":
    main()

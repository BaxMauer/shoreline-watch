#!/usr/bin/env python3
"""Build the offline Croatia map-label/search pack from a Geofabrik OSM PBF.

Requires pyosmium (`python -m pip install osmium`). The generated JSON is a
release artifact; the application never queries Overpass while navigating.
"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import osmium

BOUNDS = (13.2, 42.2, 19.6, 46.7)
PLACE_TYPES = {"city", "town", "village", "hamlet"}
ISLAND_TYPES = {"island", "islet", "archipelago"}


def feature_kind(tags: osmium.osm.TagList):
    place = tags.get("place")
    if place in ISLAND_TYPES:
        return "island", place
    if place in PLACE_TYPES:
        return "settlement", place
    if tags.get("natural") == "bay":
        return "bay", "bay"
    if tags.get("amenity") == "restaurant":
        return "restaurant", "restaurant"
    return None


def aliases(tags: osmium.osm.TagList, name: str):
    values: list[str] = []
    for key in ("name:hr", "int_name", "official_name", "short_name", "alt_name"):
        value = tags.get(key)
        if not value:
            continue
        for candidate in value.split(";"):
            candidate = candidate.strip()
            if candidate and candidate != name and candidate not in values:
                values.append(candidate)
    return values[:8]


def centre(obj):
    if isinstance(obj, osmium.osm.Node):
        return (obj.location.lon, obj.location.lat) if obj.location.valid() else None
    locations = []
    if isinstance(obj, osmium.osm.Way):
        locations = [(node.lon, node.lat) for node in obj.nodes if node.location.valid()]
    elif isinstance(obj, osmium.osm.Area):
        locations = [
            (node.lon, node.lat)
            for ring in obj.outer_rings()
            for node in ring
            if node.location.valid()
        ]
    if not locations:
        return None
    west = min(point[0] for point in locations)
    east = max(point[0] for point in locations)
    south = min(point[1] for point in locations)
    north = max(point[1] for point in locations)
    return ((west + east) / 2, (south + north) / 2)


def source_id(obj):
    if isinstance(obj, osmium.osm.Node):
        return f"n{obj.id}"
    if isinstance(obj, osmium.osm.Way):
        return f"w{obj.id}"
    if isinstance(obj, osmium.osm.Area):
        return f"{'w' if obj.from_way() else 'r'}{obj.orig_id()}"
    return None


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: extract-croatia-map-features.py INPUT.osm.pbf OUTPUT.json")
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    features = {}
    processor = osmium.FileProcessor(source).with_locations().with_areas()
    for obj in processor:
        if not isinstance(obj, (osmium.osm.Node, osmium.osm.Way, osmium.osm.Area)):
            continue
        classification = feature_kind(obj.tags)
        name = obj.tags.get("name")
        if not classification or not name:
            continue
        location = centre(obj)
        identifier = source_id(obj)
        if not location or not identifier:
            continue
        longitude, latitude = location
        west, south, east, north = BOUNDS
        if not (west <= longitude <= east and south <= latitude <= north):
            continue
        kind, subtype = classification
        candidate = {
            "id": identifier,
            "name": name.strip(),
            "aliases": aliases(obj.tags, name.strip()),
            "kind": kind,
            "subtype": subtype,
            "latitude": round(latitude, 6),
            "longitude": round(longitude, 6),
        }
        previous = features.get(identifier)
        if previous is None or isinstance(obj, osmium.osm.Area):
            features[identifier] = candidate

    values = sorted(features.values(), key=lambda feature: (feature["kind"], feature["name"], feature["id"]))
    counts = Counter(feature["kind"] for feature in values)
    cells = {}
    for index, feature in enumerate(values):
        key = f"{math.floor(feature['latitude'] * 10)}:{math.floor(feature['longitude'] * 10)}"
        cells.setdefault(key, []).append(index)
    payload = {
        "version": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": "https://download.geofabrik.de/europe/croatia.html",
        "license": "https://www.openstreetmap.org/copyright",
        "bounds": {"west": BOUNDS[0], "south": BOUNDS[1], "east": BOUNDS[2], "north": BOUNDS[3]},
        "stats": dict(sorted(counts.items())),
        "cellSizeDegrees": 0.1,
        "cells": cells,
        "features": values,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "stats": payload["stats"], "bytes": output.stat().st_size}))


if __name__ == "__main__":
    main()

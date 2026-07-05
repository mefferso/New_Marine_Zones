#!/usr/bin/env python3
"""Download NWS April 16, 2026 marine zone shapefiles and build app GeoJSON.

Source page:
https://www.weather.gov/gis/MarineZones

This builds a combined coastal + offshore GeoJSON filtered to the LIX / adjacent
GMZ zones needed for the Storm Data predefined-location QC map.
"""

from __future__ import annotations

import io
import json
import math
import pathlib
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from hashlib import md5

import shapefile  # pyshp

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT_GEOJSON = DATA_DIR / "new_marine_zones.geojson"
OUT_MANIFEST = DATA_DIR / "source_manifest.json"
RAW_DIR = DATA_DIR / "source_zips"

SOURCES = {
    "coastal_marine_zones_16ap26": "https://www.weather.gov/source/gis/Shapefiles/WSOM/mz16ap26.zip",
    "offshore_marine_zones_16ap26": "https://www.weather.gov/source/gis/Shapefiles/WSOM/oz16ap26.zip",
}

# New LIX marine-zone set plus nearby/unchanged zones represented in the working CSV.
# These IDs match the April 16, 2026 change package shown in the project notes/screenshots.
TARGET_IDS = {
    # Lakes / sounds / bays / nearshore waters
    "GMZ529", "GMZ531", "GMZ532", "GMZ533", "GMZ534", "GMZ535", "GMZ536",
    "GMZ541", "GMZ543", "GMZ551", "GMZ553", "GMZ554", "GMZ557",
    # Offshore zones still needed by current predefined locations
    "GMZ570", "GMZ572", "GMZ575", "GMZ577",
}

# Rough bounding box used only as a backstop if WFO attribution is odd.
LIX_EXTENT = {
    "min_lon": -91.5,
    "max_lon": -88.0,
    "min_lat": 27.5,
    "max_lat": 31.0,
}


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 NewMarineZonesQC/1.0"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def find_shp_stem(zf: zipfile.ZipFile) -> str:
    shp_files = [name for name in zf.namelist() if name.lower().endswith(".shp")]
    if not shp_files:
        raise RuntimeError("No .shp found in zip")
    # Prefer the main stem matching the archive if more than one exists.
    return pathlib.PurePosixPath(shp_files[0]).with_suffix("").as_posix()


def read_shapefile_from_zip(zip_bytes: bytes) -> tuple[list[dict], dict]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        stem = find_shp_stem(zf)
        parts = {}
        for ext in ("shp", "shx", "dbf", "prj"):
            name = f"{stem}.{ext}"
            if name in zf.namelist():
                parts[ext] = io.BytesIO(zf.read(name))

        if not {"shp", "shx", "dbf"}.issubset(parts):
            raise RuntimeError(f"Missing shapefile parts in zip for {stem}")

        reader = shapefile.Reader(shp=parts["shp"], shx=parts["shx"], dbf=parts["dbf"])
        field_names = [field[0] for field in reader.fields[1:]]
        features: list[dict] = []

        for shape_rec in reader.iterShapeRecords():
            props = dict(zip(field_names, shape_rec.record))
            props = clean_props(props)
            geom = shape_rec.shape.__geo_interface__
            features.append({"type": "Feature", "properties": props, "geometry": geom})

        info = {
            "stem": stem,
            "feature_count": len(features),
            "fields": field_names,
        }
        return features, info


def clean_props(props: dict) -> dict:
    out = {}
    for key, value in props.items():
        if isinstance(value, bytes):
            value = value.decode("utf-8", "replace")
        if isinstance(value, str):
            value = value.strip()
        out[key] = value
    return out


def get_id(feature: dict) -> str:
    props = feature.get("properties", {})
    for key in ("ID", "id", "UGC", "ugc", "ZONE", "zone", "GMZ", "gmz"):
        value = props.get(key)
        if value:
            return str(value).strip().upper().replace("GMZ-", "GMZ")
    return ""


def centroid_in_lix_extent(feature: dict) -> bool:
    props = feature.get("properties", {})
    try:
        lon = float(props.get("LON"))
        lat = float(props.get("LAT"))
        return (
            LIX_EXTENT["min_lon"] <= lon <= LIX_EXTENT["max_lon"]
            and LIX_EXTENT["min_lat"] <= lat <= LIX_EXTENT["max_lat"]
        )
    except Exception:
        return False


def keep_feature(feature: dict) -> bool:
    zid = get_id(feature)
    props = feature.get("properties", {})
    wfo = str(props.get("WFO", "")).upper()
    return zid in TARGET_IDS or (wfo == "LIX" and centroid_in_lix_extent(feature))


def sort_key(feature: dict) -> tuple[int, str]:
    zid = get_id(feature)
    num = "".join(ch for ch in zid if ch.isdigit())
    return (int(num) if num else 9999, zid)


def validate_ids(features: list[dict]) -> list[str]:
    found = {get_id(f) for f in features}
    missing = sorted(TARGET_IDS - found)
    return missing


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    all_features: list[dict] = []
    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_page": "https://www.weather.gov/gis/MarineZones",
        "sources": {},
        "target_ids": sorted(TARGET_IDS),
    }

    for label, url in SOURCES.items():
        print(f"Downloading {label}: {url}")
        zip_bytes = download(url)
        checksum = md5(zip_bytes).hexdigest()
        (RAW_DIR / f"{label}.zip").write_bytes(zip_bytes)

        features, info = read_shapefile_from_zip(zip_bytes)
        kept = [f for f in features if keep_feature(f)]
        print(f"  read {len(features)} features; kept {len(kept)}")
        all_features.extend(kept)

        manifest["sources"][label] = {
            "url": url,
            "md5": checksum,
            "shapefile": info,
            "kept_feature_ids": sorted(get_id(f) for f in kept),
        }

    # Deduplicate by ID, preferring the first source encountered.
    by_id = {}
    for f in all_features:
        zid = get_id(f)
        if zid and zid not in by_id:
            by_id[zid] = f

    features = sorted(by_id.values(), key=sort_key)
    missing = validate_ids(features)
    manifest["output_feature_ids"] = [get_id(f) for f in features]
    manifest["missing_target_ids"] = missing
    manifest["output_feature_count"] = len(features)

    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "NWS Marine Zones - April 16, 2026 - LIX Storm Data QC subset",
            "source_page": manifest["source_page"],
            "generated_at_utc": manifest["generated_at_utc"],
            "note": "Filtered from official NWS coastal/offshore marine-zone shapefiles for zones relevant to WFO LIX Storm Data predefined-location review.",
        },
        "features": features,
    }

    OUT_GEOJSON.write_text(json.dumps(geojson, separators=(",", ":")), encoding="utf-8")
    OUT_MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote {OUT_GEOJSON} with {len(features)} features")
    if missing:
        print("WARNING: missing target IDs:", ", ".join(missing), file=sys.stderr)
        # Do not fail; source package may rename/remove a zone, but make it very visible.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# New Marine Zones

Small Leaflet web app for reviewing Storm Data predefined marine locations after the April 16, 2026 marine zone changes.

## What this does

- Plots your predefined Storm Data locations from `data/locations.csv`
- Loads the new marine zone polygons from `data/new_marine_zones.geojson`
- Assigns each point to the polygon it falls inside
- Flags points outside all loaded zones
- Flags points within 1 mile of a zone boundary
- Lets you click the map to add new points
- Lets you double-click a marker to drag/reposition it
- Exports:
  - `supervisor_final_locations.csv`
  - `working_locations_with_zone_qc.csv`

## Current marine-zone source

`data/new_marine_zones.geojson` is generated from the official NWS April 16, 2026 marine-zone shapefile package:

- `mz16ap26.zip` coastal marine zones
- `oz16ap26.zip` offshore marine zones

The build script filters the official package to the LIX/adjoining GMZ zones needed for this Storm Data location review:

```text
GMZ529, GMZ531, GMZ532, GMZ533, GMZ534, GMZ535, GMZ536,
GMZ541, GMZ543, GMZ551, GMZ553, GMZ554, GMZ557,
GMZ570, GMZ572, GMZ575, GMZ577
```

That set intentionally matches the April 2026 changes shown in the working notes/screenshots: Lake Maurepas, Lake Pontchartrain, Lake Salvador/Cataouatche, Terrebonne Bay, Barataria Bay, Breton Sound, Chandeleur Sound, the new/reworked nearshore zones, plus the offshore GMZ zones already present in the predefined-location list.

A source manifest is written to:

```text
data/source_manifest.json
```

## Repo structure

```text
New_Marine_Zones/
├── index.html
├── app.js
├── style.css
├── scripts/
│   └── build_marine_zones.py
├── data/
│   ├── locations.csv
│   ├── new_marine_zones.geojson
│   ├── source_manifest.json
│   └── source_zips/
└── .github/workflows/
    └── build-marine-zones.yml
```

## How to use

1. Open the GitHub Pages site for this repo.
2. Review the plotted locations and auto-assigned new GMZ zones.
3. Add or adjust points as needed.
4. Export the supervisor CSV.

## Rebuilding the marine zones

Use the GitHub Action:

```text
Actions → Build marine zone GeoJSON → Run workflow
```

Or run locally:

```bash
python -m pip install pyshp
python scripts/build_marine_zones.py
```

## Important notes

- The app uses the `ID` field from the NWS marine-zone shapefiles as the GMZ identifier.
- If a point is very close to a boundary, do not trust the auto-assignment blindly. Eyeball it.
- The starting CSV intentionally leaves `new_gmz` blank so the polygon layer can assign it.
- One starting point is flagged because it has a negative latitude: `SWBNO Pump station Bayou Sauvage - Weatherstem`.

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

## Repo structure

```text
New_Marine_Zones/
├── index.html
├── app.js
├── style.css
├── data/
│   ├── locations.csv
│   └── new_marine_zones.geojson
```

## How to use

1. Open the GitHub Pages site for this repo.
2. Load the April 2026 marine zone GeoJSON if it is not already committed to `data/new_marine_zones.geojson`.
3. Review the plotted locations.
4. Add or adjust points as needed.
5. Export the supervisor CSV.

## Converting the shapefile to GeoJSON

The app wants GeoJSON. If you have the shapefile pieces locally, the easiest conversion is with Mapshaper.

Install once:

```bash
npm install -g mapshaper
```

Then run something like:

```bash
mapshaper c_16ap26.shp -proj wgs84 -o format=geojson data/new_marine_zones.geojson
```

If the desired marine polygons are in a different shapefile, use that `.shp` instead.

## Important notes

- The app tries to detect the zone ID from common fields like `UGC`, `ID`, `ZONE`, `GMZ`, `GM_ZONE`, and similar.
- If a point is very close to a boundary, do not trust the auto-assignment blindly. Eyeball it.
- The starting CSV intentionally leaves `new_gmz` blank so the polygon layer can assign it.
- One starting point is flagged because it has a negative latitude: `SWBNO Pump station Bayou Sauvage - Weatherstem`.

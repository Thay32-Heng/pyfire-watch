# PyFire Watch

One burning-activity calendar for a chosen area, built from NASA FIRMS
MODIS C6.1 and VIIRS C2 active-fire detections.

**What it does**
- Pulls real NASA FIRMS data (MODIS since 2000, VIIRS since 2012).
- Normalises confidence across the two incompatible scales.
- Harmonises the two sensors: one grid, one clock, densities instead of
  raw counts, calibration factor `c_m` on the 2012–present overlap.
- Renders a year × week calendar heatmap with a climatology band and a
  normal / unusual / critical label per week.
- Sensor toggle (MODIS only · VIIRS only · harmonized) so the 2012 step
  disappears on screen.
- Exports CSV / PNG.

**Status:** v0.1 — 8 days of real Cambodia data (MODIS 28 + VIIRS 133,
Oct 2026). Full 25-year history needs a free FIRMS MAP_KEY (see
`pipeline/fetch_firms.py`).

**Run**
```
python3 pipeline/harmonize.py
python3 pipeline/build_web_data.py
python3 -m http.server --directory web 8000
```
Open http://localhost:8000
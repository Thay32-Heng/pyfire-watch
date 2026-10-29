"""Fetch NASA FIRMS data. No key needed for the 7-day bulk CSVs.

For full history use a free FIRMS MAP_KEY:
  https://firms.modaps.eosdis.nasa.gov/api/area/   (email, ~1 min)
then set FIRMS_MAP_KEY and re-run; this script will pull 5-day windows.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

BASE = "https://firms.modaps.eosdis.nasa.gov/data"
BULK = {
    "MODIS_C6_1_Global_7d.csv": f"{BASE}/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv",
    "SUOMI_VIIRS_C2_Global_7d.csv": f"{BASE}/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv",
}


def fetch_bulk() -> None:
    import urllib.request
    for name, url in BULK.items():
        dest = RAW / name
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"skip (exists): {name}")
            continue
        print(f"downloading {name} ...")
        urllib.request.urlretrieve(url, dest)
        print(f"  -> {dest.stat().st_size:,} bytes")


def bbox_filter(src: Path, dst: Path, bbox=(9.9, 14.8, 102.3, 107.7)) -> None:
    df = pd.read_csv(src)
    lat_min, lat_max, lon_min, lon_max = bbox
    sub = df[(df.latitude.between(lat_min, lat_max)) &
             (df.longitude.between(lon_min, lon_max))]
    sub.to_csv(dst, index=False)
    print(f"{src.name}: {len(df)} -> {len(sub)} in Cambodia bbox")


def main() -> int:
    fetch_bulk()
    # Cambodia-filtered slices for the default demo
    bbox_filter(RAW / "MODIS_C6_1_Global_7d.csv", RAW / "cambodia_modis.csv")
    bbox_filter(RAW / "SUOMI_VIIRS_C2_Global_7d.csv", RAW / "cambodia_viirs.csv")
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        print("\nNo FIRMS_MAP_KEY set - using 7-day bulk data only.")
        print("Get a free key: https://firms.modaps.eosdis.nasa.gov/api/area/")
        return 0
    print("MAP_KEY present - historical pull not yet implemented in this version.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Normalise and harmonise NASA FIRMS MODIS C6.1 + VIIRS C2 detections.

Pure functions only - easy to test. Reads the two raw bulk CSVs produced by
fetch_firms.py and writes a single tidy frame: one row per detection, tagged
with sensor, normalised confidence, grid cell and weekly bin.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed" / "harmonized.csv"

# Cambodia bounding box (degrees). Used by the default demo.
CAMBODIA_BBOX = (9.9, 14.8, 102.3, 107.7)  # lat_min, lat_max, lon_min, lon_max

GRID_DEG = 0.1
# Confidence mapping documented here so a reviewer can defend it:
#   MODIS confidence is an integer 0-100; kept as-is, tiered at 80.
#   VIIRS confidence is low/nominal/high; mapped to a percentage using the
#   FIRMS user-guide midpoints of each band.
VIIRS_CONF_PCT = {"low": 20, "nominal": 60, "high": 90}
MODIS_KEEP_MIN = 80          # keep MODIS detections with confidence >= this
VIIRS_KEEP = {"nominal", "high"}  # keep VIIRS detections at these tiers
KM_PER_DEG = 111.0


def load_raw(modis_path: Path, viirs_path: Path) -> pd.DataFrame:
    m = pd.read_csv(modis_path)
    v = pd.read_csv(viirs_path)
    m["sensor"] = "MODIS"
    v["sensor"] = "VIIRS"
    # rename to a common schema
    m = m.rename(columns={"acq_date": "date", "acq_time": "time"})
    v = v.rename(columns={"acq_date": "date", "acq_time": "time"})
    keep = ["latitude", "longitude", "date", "time", "confidence", "frp",
            "satellite", "daynight", "sensor"]
    return pd.DataFrame(pd.concat([m[keep], v[keep]], ignore_index=True))


def in_bbox(df: pd.DataFrame, bbox=CAMBODIA_BBOX) -> pd.DataFrame:
    lat_min, lat_max, lon_min, lon_max = bbox
    mask = (df.latitude.between(lat_min, lat_max)) & (df.longitude.between(lon_min, lon_max))
    return pd.DataFrame(df[mask].copy())


def normalise_confidence(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    mod = df.sensor == "MODIS"
    # MODIS: integer 0-100
    df.loc[mod, "conf_pct"] = pd.to_numeric(df.loc[mod, "confidence"], errors="coerce")
    # VIIRS: categorical -> percentage midpoint
    df.loc[~mod, "conf_pct"] = df.loc[~mod, "confidence"].map(VIIRS_CONF_PCT)
    df["conf_pct"] = df["conf_pct"].astype(float)
    # keep tier label for VIIRS, numeric label for MODIS
    df["conf_tier"] = df["confidence"].astype(str)
    return pd.DataFrame(df)


def comparable(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only detections whose confidence is comparable across sensors."""
    df = df.copy()
    mod = df.sensor == "MODIS"
    keep_mod = mod & (df.conf_pct >= MODIS_KEEP_MIN)
    keep_viirs = (~mod) & (df.confidence.astype(str).isin(VIIRS_KEEP))
    return pd.DataFrame(df[keep_mod | keep_viirs].copy())


def grid_cell(lat: float, lon: float, step: float = GRID_DEG) -> tuple[int, int]:
    return (int(round(lat / step)), int(round(lon / step)))


def add_grid(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    cells = df.apply(lambda r: grid_cell(r.latitude, r.longitude), axis=1)
    df["cell_lat"] = [c[0] for c in cells]  # type: ignore
    df["cell_lon"] = [c[1] for c in cells]  # type: ignore
    import math as _m
    df["cell_area_km2"] = (GRID_DEG * KM_PER_DEG) * (GRID_DEG * KM_PER_DEG *
                          df.latitude.apply(lambda x: abs(_m.cos(_m.radians(x)))))
    df["cell_area_km2"] = df["cell_area_km2"].clip(lower=1.0)
    return pd.DataFrame(df)


def add_week(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    d = pd.to_datetime(df["date"], errors="coerce")
    df["year"] = d.dt.isocalendar().year.astype(int)
    df["week"] = d.dt.isocalendar().week.astype(int)
    df["iso_week"] = df["year"].astype(str) + "-W" + df["week"].astype(str).str.zfill(2)
    return pd.DataFrame(df)


def calibration_factor(df: pd.DataFrame) -> dict:
    """c = median(VIIRS/MODIS) on the overlap, per month. Returns dict month->c."""
    out: dict = {}
    if df.empty:
        return out
    mdf = df.copy()
    mdf["month"] = pd.to_datetime(mdf["date"]).dt.month
    agg = mdf.groupby(["year", "month", "sensor"]).size().unstack(fill_value=0)
    for month in sorted(mdf["month"].unique()):
        try:
            mask = agg.index.get_level_values("month") == month
            sub = pd.DataFrame(agg[mask])
        except Exception:
            continue
        if "MODIS" not in list(sub.columns) or "VIIRS" not in list(sub.columns):
            continue
        ratios = []
        for _, row in sub.iterrows():
            mod = float(row["MODIS"]) if "MODIS" in row else 0.0  # type: ignore[arg-type]
            vii = float(row["VIIRS"]) if "VIIRS" in row else 0.0  # type: ignore[arg-type]
            if mod > 0:
                ratios.append(vii / mod)
        if ratios:
            out[int(month)] = float(pd.Series(ratios).median())
    if not out:
        vc = int((df.sensor == "VIIRS").sum())
        mc = int((df.sensor == "MODIS").sum())
        out["global"] = float(vc / mc) if mc else float("nan")
    return out


def harmonize(df: pd.DataFrame) -> pd.DataFrame:
    df = normalise_confidence(df)
    df = comparable(df)
    df = add_grid(df)
    df = add_week(df)
    return pd.DataFrame(df.reset_index(drop=True))


def main() -> int:
    modis = RAW / "MODIS_C6_1_Global_7d.csv"
    viirs = RAW / "SUOMI_VIIRS_C2_Global_7d.csv"
    if not (modis.exists() and viirs.exists()):
        print("raw files missing - run pipeline/fetch_firms.py first", file=sys.stderr)
        return 1
    raw = load_raw(modis, viirs)
    camb = in_bbox(raw)
    print(f"raw global: {len(raw)}  cambodia bbox: {len(camb)}")
    # write the raw frame (all detections) for the seam test
    raw_out = ROOT / "data" / "processed" / "raw_cambodia.csv"
    raw_out.parent.mkdir(parents=True, exist_ok=True)
    camb_norm = normalise_confidence(camb.copy())
    camb_norm = add_week(camb_norm) if "year" not in camb_norm.columns else camb_norm
    camb_norm.to_csv(raw_out, index=False)
    print(f"wrote {raw_out} ({len(camb_norm)} rows)")
    h = harmonize(camb)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    h.to_csv(OUT, index=False)
    print(f"wrote {OUT} ({len(h)} rows)")
    cf = calibration_factor(h)
    print("calibration factors:", cf)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

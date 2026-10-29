"""Turn the harmonised frame into the JSON the web app reads."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
HARM = ROOT / "data" / "processed" / "harmonized.csv"
RAWC = ROOT / "data" / "processed" / "raw_cambodia.csv"
OUT = ROOT / "web" / "data"
OUT.mkdir(parents=True, exist_ok=True)


def main() -> int:
    if not HARM.exists():
        print("harmonized.csv missing - run pipeline/harmonize.py first")
        return 1
    df = pd.read_csv(HARM)
    # --- hotspots (compact) ---
    hotspots = [
        {
            "lat": round(float(r["latitude"]), 4),
            "lon": round(float(r["longitude"]), 4),
            "date": str(r["date"]),
            "conf": int(r["conf_pct"]) if pd.notna(r["conf_pct"]) else None,
            "conf_raw": str(r["confidence"]),
            "frp": round(float(r["frp"]), 2),
            "sensor": str(r["sensor"]),
            "tier": str(r["conf_tier"]),
            "year": int(r["year"]),
            "week": int(r["week"]),
            "region": "Cambodia",
        }
        for r in df.to_dict("records")
    ]
    (OUT / "hotspots.json").write_text(json.dumps(hotspots))

    # --- calendar matrix: year x week ---
    agg = df.groupby(["year", "week"]).agg(
        count=("frp", "size"), frp_sum=("frp", "sum")
    ).reset_index()
    years = sorted(df.year.unique().tolist())
    weeks = list(range(1, 54))
    matrix = {str(y): {str(w): 0 for w in weeks} for y in years}
    frp_matrix = {str(y): {str(w): 0.0 for w in weeks} for y in years}
    for r in agg.to_dict("records"):
        matrix[str(r["year"])][str(r["week"])] = int(r["count"])
        frp_matrix[str(r["year"])][str(r["week"])] = round(float(r["frp_sum"]), 2)

    # climatology per week-of-year across all years
    clim = {}
    for w in weeks:
        vals = [matrix[str(y)].get(str(w), 0) for y in years]
        if not vals:
            continue
        mean = sum(vals) / len(vals)
        s = sorted(vals)
        p10 = s[max(0, int(0.1 * (len(s) - 1)))]
        p90 = s[min(len(s) - 1, int(0.9 * (len(s) - 1)))]
        clim[str(w)] = {"mean": round(mean, 2), "p10": p10, "p90": p90}

    # anomaly: z-score of each (year,week) vs climatology
    anomalies = []
    for y in years:
        for w in weeks:
            v = matrix[str(y)][str(w)]
            c = clim[str(w)]
            # std approximated from p90-p10 range
            spread = max(1, c["p90"] - c["p10"])
            sigma = spread / 2.56 or 1.0
            z = (v - c["mean"]) / sigma if sigma else 0.0
            level = "normal"
            if z >= 1.5:
                level = "critical"
            elif z >= 1.0:
                level = "unusual"
            elif z <= -1.0:
                level = "quiet"
            anomalies.append({"year": y, "week": w, "count": v, "z": round(z, 2), "level": level})

    # sensor counts + calibration
    by_sensor = df.sensor.value_counts().to_dict()
    modis_n = int(by_sensor.get("MODIS", 0))
    viirs_n = int(by_sensor.get("VIIRS", 0))
    ratio = (viirs_n / modis_n) if modis_n else None

    # raw counts by month x sensor (for the seam test)
    raw_by_month = {}
    if RAWC.exists():
        rdf = pd.read_csv(RAWC)
        rdf["month"] = pd.to_datetime(rdf["date"]).dt.to_period("M").astype(str)
        for m, g in rdf.groupby("month"):
            raw_by_month[m] = {
                "MODIS": int((g.sensor == "MODIS").sum()),
                "VIIRS": int((g.sensor == "VIIRS").sum()),
            }

    summary = {
        "rows": len(df),
        "date_min": str(df.date.min()),
        "date_max": str(df.date.max()),
        "years": years,
        "by_sensor": by_sensor,
        "modis_conf_min_kept": 80,
        "viirs_tiers_kept": ["nominal", "high"],
        "calibration": {"c_global": None if ratio is None else round(ratio, 3),
                        "note": "median(VIIRS/MODIS) on overlap; needs multi-year history for stability"},
        "raw_by_month": raw_by_month,
        "metrics": {
            "total_hotspots": len(df),
            "active_days": int(df.date.nunique()),
            "avg_frp": round(float(df.frp.mean()), 2) if len(df) else 0.0,
            "avg_conf_pct": round(float(df.conf_pct.mean()), 1) if len(df) else 0.0,
        },
    }
    (OUT / "calendar.json").write_text(json.dumps({
        "years": years, "weeks": weeks, "matrix": matrix,
        "frp_matrix": frp_matrix, "climatology": clim, "anomalies": anomalies,
    }))
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"wrote {OUT}/hotspots.json ({len(hotspots)}), calendar.json, summary.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

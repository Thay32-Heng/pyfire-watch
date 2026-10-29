import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import pandas as pd
from harmonize import (normalise_confidence, comparable, add_grid, add_week,
                       in_bbox, VIIRS_CONF_PCT, MODIS_KEEP_MIN)


class TestHarmonize(unittest.TestCase):
    def test_confidence_normalise(self):
        df = pd.DataFrame({
            "latitude": [11.5, 11.6], "longitude": [104.9, 105.0],
            "sensor": ["MODIS", "VIIRS"], "confidence": [85, "nominal"],
            "frp": [10.0, 5.0], "date": ["2026-10-22", "2026-10-22"],
        })
        out = normalise_confidence(df)
        self.assertEqual(out.loc[0, "conf_pct"], 85)
        self.assertEqual(out.loc[1, "conf_pct"], VIIRS_CONF_PCT["nominal"])
        self.assertEqual(out.loc[1, "conf_tier"], "nominal")

    def test_comparable_filters(self):
        df = pd.DataFrame({
            "latitude": [11.5, 11.6, 11.7], "longitude": [104.9, 105.0, 105.1],
            "sensor": ["MODIS", "MODIS", "VIIRS"],
            "confidence": [50, 90, "low"],
            "conf_pct": [50.0, 90.0, 20.0],
            "conf_tier": ["50", "90", "low"],
            "frp": [1.0, 2.0, 3.0], "date": ["2026-10-22"]*3,
        })
        out = comparable(df)
        self.assertEqual(len(out), 1)
        self.assertEqual(out.iloc[0]["sensor"], "MODIS")

    def test_grid_and_week(self):
        df = pd.DataFrame({
            "latitude": [11.55], "longitude": [104.92],
            "sensor": ["MODIS"], "confidence": [90], "conf_pct": [90.0],
            "conf_tier": ["90"], "frp": [5.0], "date": ["2026-10-22"],
        })
        g = add_grid(df)
        self.assertIn("cell_lat", g.columns)
        self.assertIn("cell_area_km2", g.columns)
        w = add_week(g)
        self.assertEqual(int(w.loc[0, "year"]), 2026)
        self.assertTrue(1 <= int(w.loc[0, "week"]) <= 53)

    def test_in_bbox(self):
        df = pd.DataFrame({
            "latitude": [11.5, 0.0], "longitude": [104.9, 0.0],
            "sensor": ["MODIS", "MODIS"], "confidence": [90, 90],
            "frp": [1.0, 1.0], "date": ["2026-10-22", "2026-10-22"],
        })
        out = in_bbox(df)
        self.assertEqual(len(out), 1)


if __name__ == "__main__":
    unittest.main()

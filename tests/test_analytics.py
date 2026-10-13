import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from analytics import aggregate, classify, prefix

class AnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.rows=[dict(amount="100.25",supplier_key="test ltd",supplier_raw="Test LTD",
             agency_key="moa",agency_raw="MOA",report_period=p,
             description="Feed Supply for Golden Yolk 2025") for p in ("2025-01","2025-02","2025-03")]
    def test_source_grouping(self):
        x=aggregate(self.rows)
        self.assertEqual(x["total_source_rows"],3)
        self.assertEqual(x["distinct_supplier_keys"],1)
        self.assertEqual(x["top_suppliers"][0]["nominal_value"],"300.75")
        self.assertEqual(len(x["repeat_title_prefix_candidates"]),1)
    def test_cautious_labels(self):
        self.assertIsNone(prefix("Procurement Bitumen - Duplicate 2"))
        self.assertEqual(classify("Chicken feed procurement"),"Agriculture")
if __name__ == "__main__":
    unittest.main()

import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from analytics import aggregate, classify, prefix, quality_of
from reconcile import project_signature, cached_match

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
    def test_quality_checks(self):
        base = dict(award_date_iso="2026-02-12", report_period="2026-02")
        self.assertEqual(quality_of(base, {"2026-02": {"status": "totals_match"}}), "reconciled")
        self.assertEqual(quality_of(base, {"2026-02": {"status": "totals_match_cached"}}), "reconciled")
        self.assertEqual(quality_of(base, {"2026-02": {"status": "totals_mismatch"}}), "summary_mismatch")
        self.assertEqual(quality_of({**base, "award_date_iso": None}, {"2026-02": {"status": "totals_match"}}), "undated")

    def test_cached_reconciliation_requires_identical_records(self):
        sample = [dict(id="record-a", amount="12.50", source_sha256="file-a")]
        sig = project_signature(sample)
        old = dict(status="totals_match", project_signature=sig, verified_at="2026-01-01T00:00:00Z")
        self.assertEqual(cached_match(old, sig)["status"], "totals_match_cached")
        changed = [dict(id="record-a", amount="12.51", source_sha256="file-a")]
        self.assertIsNone(cached_match(old, project_signature(changed)))
        self.assertIsNone(cached_match(dict(status="totals_mismatch", project_signature=sig),sig))

    def test_cautious_labels(self):
        self.assertIsNone(prefix("Procurement Bitumen - Duplicate 2"))
        self.assertEqual(classify("Chicken feed procurement"),"Agriculture")
if __name__ == "__main__":
    unittest.main()

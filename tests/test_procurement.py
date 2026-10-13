import io
import sys
import unittest
from pathlib import Path
from zipfile import ZipFile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from procurement import read_xlsx, extract_awards, parse_amount, detect_header, period_from_name, normalize_name

def sample_xlsx():
    sheet = '''<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
    <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>15000.55</v></c><c r="C2" t="inlineStr"><is><t>Ministry of Finance</t></is></c><c r="D2" t="s"><v>5</v></c></row>
    <row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3"><v>2500</v></c><c r="C3" t="s"><v>7</v></c><c r="D3" t="s"><v>8</v></c></row>
    </sheetData></worksheet>'''
    strings = ["Supplier Name","Contract Amount","Ministry","Description","Example Solutions Ltd","Website Design","Mel J Events","Ministry of Youth","Event Rentals"]
    ss = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + ''.join(f'<si><t>{s}</t></si>' for s in strings) + '</sst>'
    wb = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Awards" sheetId="1" r:id="rId1"/></sheets></workbook>'
    rel = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>'
    buf = io.BytesIO()
    with ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", rel)
        z.writestr("xl/sharedStrings.xml", ss)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()

class TestProcurement(unittest.TestCase):
    def test_read_xlsx(self):
        sheets = read_xlsx(sample_xlsx())
        self.assertEqual(sheets[0][0], "Awards")
        self.assertEqual(sheets[0][1][1][0], "Example Solutions Ltd")
        self.assertEqual(str(sheets[0][1][1][1]), "15000.55")
    def test_extract_awards(self):
        report = {"url":"https://mofvendors.gov.bs/a.xlsx", "notice_url":"https://mofvendors.gov.bs/notice/", "period":"2026-07"}
        data, diag = extract_awards(sample_xlsx(), report)
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["amount"], "15000.55")
        self.assertEqual(data[0]["supplier_key"], "example solutions ltd")
        self.assertEqual(data[1]["agency_raw"], "Ministry of Youth")
        self.assertEqual(data[0]["row"], 2)
        self.assertTrue(data[0]["source_sha256"])
    def test_reject_html(self):
        with self.assertRaises(ValueError):
            read_xlsx(b"<html>captcha</html>")
    def test_header_must_be_explicit(self):
        self.assertIsNone(detect_header([["Name", "Balance"], ["Example", "500"]])[0])
    def test_currency_parsing(self):
        self.assertEqual(parse_amount("B$ 12,500.00"), "12500.00")
        self.assertIsNone(parse_amount("TBD"))
        self.assertIsNone(parse_amount("-100"))
    def test_filename_date_and_name(self):
        self.assertEqual(period_from_name("https://mofvendors.gov.bs/PROJECT-AWARDS-JULY-1-31-2026.xlsx"), "2026-07")
        self.assertEqual(normalize_name(" Mel J’s & Co. "), "mel j s and co")

if __name__ == "__main__":
    unittest.main()

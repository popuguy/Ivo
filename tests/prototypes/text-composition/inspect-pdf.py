"""Independent PDF parsing of the headless native proof, with no source/font files installed."""
import json
import math
import re
import sys
from pathlib import Path
import pdfplumber
from pypdf import PdfReader
from pypdf.generic import ContentStream

out = Path(sys.argv[1])
proof = json.loads((out / "latin.json").read_text())
request, result = proof["request"], proof["result"]
reader = PdfReader(out / "latin.pdf")
assert len(reader.pages) == len(request["frames"])
font_count = 0
embedded_names = set()
for page, frame in zip(reader.pages, request["frames"]):
    assert abs(float(page.mediabox.width) - frame["width"] - 40) < 0.001
    assert abs(float(page.mediabox.height) - frame["height"] - 40) < 0.001
    for reference in page.get("/Resources", {}).get("/Font", {}).values():
        font = reference.get_object()
        if font.get("/Subtype") == "/Type0":
            face = font["/DescendantFonts"][0].get_object()
        else:
            face = font
        descriptor = face.get("/FontDescriptor")
        assert descriptor, "Text was outlined or has no font descriptor"
        descriptor = descriptor.get_object()
        assert any(key in descriptor for key in ["/FontFile", "/FontFile2", "/FontFile3"]), "Font is not embedded"
        assert "/ToUnicode" in font or font.get("/Encoding") == "/MacRomanEncoding", "PDF has no tested text mapping"
        embedded_names.add(str(font.get("/BaseFont")))
        font_count += 1
assert font_count >= 3, "Mixed real font faces were not exercised"
extracted = "".join(page.extract_text() or "" for page in reader.pages)
compact = lambda text: re.sub(r"\s", "", text)
# Quartz keeps original ligature source in ActualText; pypdf's plain extractor
# currently returns the compatibility scalar from ToUnicode instead.
ligatures = {"\ufb00":"ff", "\ufb01":"fi", "\ufb02":"fl", "\ufb03":"ffi", "\ufb04":"ffl"}
expanded = "".join(ligatures.get(char, char) for char in extracted)
assert compact(expanded) == compact(request["text"]), "PDF text differs beyond known ligature compatibility scalars"
actual = []
for page in reader.pages:
    for operands, operator in ContentStream(page.get_contents(), reader).operations:
        if operator == b"BDC" and len(operands) == 2 and "/ActualText" in operands[1]:
            actual.append(str(operands[1]["/ActualText"]))
assert actual.count("ffi") == 2, "Original ligature source is not retained in PDF ActualText"
matched_lines = 0
with pdfplumber.open(out / "latin.pdf") as document:
    for line in result["layout"]["lines"]:
        if not request["text"][line["start"]:line["end"]].strip():
            continue
        page = document.pages[line["page"]]
        expected_y = float(page.height) - 20 - line["baseline"]
        chars = [char for char in page.chars if abs(char["matrix"][5] - expected_y) < 0.001]
        assert chars, "PDF baseline differs from frozen native line"
        assert all(math.isfinite(float(value)) for char in chars for value in char["matrix"])
        first = min(chars, key=lambda char: char["matrix"][4])
        assert abs(first["matrix"][4] - 20) < 0.001, "PDF line origin differs from native geometry"
        matched_lines += 1
assert matched_lines > 10
print(json.dumps({"pages": len(reader.pages), "embeddedFontNames": sorted(embedded_names), "latinSourceEquivalent": True, "actualTextForLigatures": True, "plainExtractorReturnsLigatureScalars": True, "matchedNativeBaselines": matched_lines}))

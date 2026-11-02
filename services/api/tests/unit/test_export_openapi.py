import json

from app.export_openapi import export


def test_export_writes_sorted_spec_with_health(tmp_path):
    out = tmp_path / "openapi.json"
    export(out)
    text = out.read_text(encoding="utf-8")
    spec = json.loads(text)
    assert spec["paths"]["/api/v1/health"]["get"]["operationId"] == "getHealth"
    assert text.endswith("\n") and text == json.dumps(spec, indent=2, sort_keys=True) + "\n"


def test_export_is_deterministic(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    export(a)
    export(b)
    assert a.read_bytes() == b.read_bytes()

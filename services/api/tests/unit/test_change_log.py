"""The JSON leaf diff behind the change log (FR-VERIFY-007; review-flow Task 3)."""

from app.services.change_log import diff, leaves


def test_diff_scalar_change():  # AC-FR-VERIFY-007-01
    assert diff({"g": {"total": "12000.00"}}, {"g": {"total": "12500.00"}}) == [
        ("g.total", "12000.00", "12500.00")
    ]


def test_diff_row_delete_and_edit():  # AC-FR-VERIFY-007-02
    before = {"g": {"items": [{"qty": "1", "name": "A"}, {"qty": "3", "name": "B"}]}}
    after = {"g": {"items": [{"qty": "2", "name": "A"}]}}
    assert diff(before, after) == [
        ("g.items[0].qty", "1", "2"),
        ("g.items[1].name", "B", None),
        ("g.items[1].qty", "3", None),
    ]


def test_diff_none_before():
    assert diff(None, {"g": {"a": "1", "b": None}}) == [("g.a", None, "1")]


def test_diff_equal():
    data = {"g": {"a": "1", "rows": [{"x": 1}]}}
    assert diff(data, {"g": {"a": "1", "rows": [{"x": 1}]}}) == []


def test_empty_containers_are_leaves():
    assert leaves({"g": {"rows": [], "meta": {}}}) == {"g.rows": [], "g.meta": {}}
    assert diff({"g": {"rows": [{"x": "1"}]}}, {"g": {"rows": []}}) == [
        ("g.rows", None, []),
        ("g.rows[0].x", "1", None),
    ]


def test_scalar_lists_by_index():
    assert diff({"g": {"tel": ["1", "2"]}}, {"g": {"tel": ["1", "3"]}}) == [("g.tel[1]", "2", "3")]

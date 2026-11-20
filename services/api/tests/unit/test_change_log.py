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
    # emptying a table reports its deleted rows, not the empty container (minor-fixes-ui)
    assert diff({"g": {"rows": [{"x": "1"}]}}, {"g": {"rows": []}}) == [("g.rows[0].x", "1", None)]


def test_scalar_lists_by_index():
    assert diff({"g": {"tel": ["1", "2"]}}, {"g": {"tel": ["1", "3"]}}) == [("g.tel[1]", "2", "3")]


# --- minor-fixes-ui: row alignment, filled containers, numeric order (FR-VERIFY-007) ---


def _rows(n):
    return [{"qty": str(i), "name": f"R{i}"} for i in range(n)]


def test_delete_middle_row_logs_only_that_row():  # AC-FR-VERIFY-007-04
    before = {"g": {"items": _rows(10)}}
    after = {"g": {"items": _rows(10)[1:]}}
    assert diff(before, after) == [("g.items[0].name", "R0", None), ("g.items[0].qty", "0", None)]


def test_filled_empty_table_not_logged():  # AC-FR-VERIFY-007-05
    before = {"document": {"no": "1"}}
    after = {"document": {"no": "2"}, "goods": {"line_items": []}}
    assert diff(before, after) == [("document.no", "1", "2")]


def test_numeric_row_order():  # AC-FR-VERIFY-007-06
    before = {"g": {"items": _rows(11)}}
    rows = _rows(11)
    rows[2] = {"qty": "x", "name": "R2"}
    rows[10] = {"qty": "y", "name": "R10"}
    assert [p for p, _, _ in diff(before, {"g": {"items": rows}})] == [
        "g.items[2].qty",
        "g.items[10].qty",
    ]


def test_edit_and_delete_rows():  # Review Focus 1
    a, b, c = {"qty": "1", "n": "A"}, {"qty": "2", "n": "B"}, {"qty": "3", "n": "C"}
    after_c = {"qty": "9", "n": "C"}
    got = diff({"g": {"items": [a, b, c]}}, {"g": {"items": [a, after_c]}})
    assert ("g.items[1].qty", "3", "9") in got
    assert ("g.items[1].n", "B", None) in got and ("g.items[1].qty", "2", None) in got
    assert len(got) == 3


def test_emptied_table_logs_rows():  # Review Focus 2
    got = diff({"g": {"items": [{"qty": "1"}]}}, {"g": {"items": []}})
    assert got == [("g.items[0].qty", "1", None)]


# --- final review: bounded alignment (C1) and a sort that never mixes types (I1) ---


def test_large_tables_stay_fast():
    import time

    old = {"g": {"t": [{"a": str(i), "b": "x"} for i in range(3000)]}}
    new_rows = [{"a": str(i), "b": "y"} for i in range(3000)]  # every row changed: no common ends
    started = time.monotonic()
    got = diff(old, {"g": {"t": new_rows}})
    assert time.monotonic() - started < 2.0
    assert len(got) == 3000 and got[0] == ("g.t[0].b", "x", "y")


def test_one_change_in_a_long_table_is_found_quickly():
    import time

    rows = [{"a": str(i)} for i in range(5000)]
    changed = [dict(r) for r in rows]
    changed[2500] = {"a": "edited"}
    del changed[10]
    started = time.monotonic()
    got = diff({"g": {"t": rows}}, {"g": {"t": changed}})
    assert time.monotonic() - started < 2.0
    assert ("g.t[10].a", "10", None) in got
    assert ("g.t[2499].a", "2500", "edited") in got
    assert len(got) == 2


def test_digit_and_name_keys_sort_without_error():
    got = diff({"d": {"2": "x", "name": "y"}}, {"d": {"2": "z", "name": "w"}})
    assert {p for p, _, _ in got} == {"d.2", "d.name"}


def test_table_replaced_by_object():
    got = diff({"g": {"items": [{"a": 1}]}}, {"g": {"items": {"a": 2}}})
    assert ("g.items.a", None, 2) in got and ("g.items[0].a", 1, None) in got

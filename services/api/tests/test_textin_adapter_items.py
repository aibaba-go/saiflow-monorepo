"""textin.adapter.normalize_items_to_rows 的纯单测。

对应 task 2.3 的验证：
- (a) 单行多列：cells 顺序保留，kv/cell_positions 同步。
- (b) 行内重复 key：后值覆盖前值。
- (c) 缺 key 的 cell：用 `${row}-${col}` 占位（可读、可唯一定位）。
- 防御：非 list 输入 → 空行列表；非 dict cell → 跳过；行内非 list 元素 → 跳过。
"""

from __future__ import annotations

from typing import Any

import pytest

from textin.adapter import normalize_items_to_rows


# --- (a) 单行多列 ----------------------------------------------------------


def test_single_row_multiple_columns_returns_one_row_with_ordered_cells() -> None:
    """单行多列：cells 数组保持入站 cell 顺序；kv/cell_positions 与之一一对应。"""
    items = [
        [
            {"key": "amount", "value": "100", "position": [{"page": 1, "vertices": [0, 0, 1, 0, 1, 1, 0, 1]}]},
            {"key": "currency", "value": "USD", "position": []},
            {"key": "date", "value": "2026-10-19", "position": []},
        ]
    ]
    out = normalize_items_to_rows(items)

    assert len(out) == 1
    row = out[0]
    assert row["row_index"] == 0
    assert [c["key"] for c in row["cells"]] == ["amount", "currency", "date"]
    assert [c["value"] for c in row["cells"]] == ["100", "USD", "2026-10-19"]
    assert row["kv"] == {"amount": "100", "currency": "USD", "date": "2026-10-19"}
    assert len(row["cell_positions"]) == 3
    assert row["cell_positions"][0] == {
        "key": "amount",
        "position": [{"page": 1, "vertices": [0, 0, 1, 0, 1, 1, 0, 1]}],
    }


def test_multiple_rows_preserve_indices_in_order() -> None:
    """多行：row_index 0/1/2 与原始 items 顺序一致。"""
    items = [
        [{"key": "a", "value": "1", "position": []}],
        [{"key": "b", "value": "2", "position": []}],
        [{"key": "c", "value": "3", "position": []}],
    ]
    out = normalize_items_to_rows(items)
    assert [r["row_index"] for r in out] == [0, 1, 2]
    assert [r["kv"] for r in out] == [{"a": "1"}, {"b": "2"}, {"c": "3"}]


# --- (b) 行内重复 key：后值覆盖前值 -------------------------------------------


def test_duplicate_key_in_same_row_later_value_overrides() -> None:
    """同 key 出现两次：cells 数组保留两次（顺序可见），kv 取最后一个值。"""
    items = [
        [
            {"key": "amount", "value": "100", "position": [{"page": 1}]},
            {"key": "amount", "value": "200", "position": [{"page": 2}]},
            {"key": "amount", "value": "300", "position": []},
        ]
    ]
    out = normalize_items_to_rows(items)
    row = out[0]
    assert len(row["cells"]) == 3
    assert [c["value"] for c in row["cells"]] == ["100", "200", "300"]
    assert row["kv"]["amount"] == "300"
    # cell_positions 也按遇到顺序，三个都保留
    assert len(row["cell_positions"]) == 3
    assert row["cell_positions"][-1]["position"] == []


def test_duplicate_key_does_not_lose_earlier_position_entries() -> None:
    """重复 key 时每个 cell 的 position 都保留，cell_positions 全部列出。"""
    items = [
        [
            {"key": "k", "value": "v1", "position": [{"page": 1, "vertices": [1, 1, 2, 2, 3, 3, 4, 4]}]},
            {"key": "k", "value": "v2", "position": [{"page": 2, "vertices": [5, 5, 6, 6, 7, 7, 8, 8]}]},
        ]
    ]
    out = normalize_items_to_rows(items)
    positions = [c["position"] for c in out[0]["cell_positions"]]
    assert positions[0][0]["page"] == 1
    assert positions[1][0]["page"] == 2


# --- (c) 缺 key 的 cell：用 `${row}-${col}` 占位 ------------------------------


def test_cell_missing_key_uses_placeholder() -> None:
    """cell.key 缺失（None / 空字符串）→ 用 `${row_index}-${col_index}` 占位。"""
    items = [
        [
            {"value": "no-key-1", "position": []},          # col 0
            {"key": "", "value": "no-key-2", "position": []},  # col 1 (empty key)
            {"key": "named", "value": "v", "position": []},    # col 2
        ]
    ]
    out = normalize_items_to_rows(items)
    row = out[0]
    assert [c["key"] for c in row["cells"]] == ["0-0", "0-1", "named"]
    assert row["kv"]["0-0"] == "no-key-1"
    assert row["kv"]["0-1"] == "no-key-2"
    assert row["kv"]["named"] == "v"


def test_cell_missing_key_placeholder_uses_actual_indices() -> None:
    """占位符索引就是它真实位置（rows 2nd line, col 3rd → `1-2`）。"""
    items = [
        [{"key": "a", "value": "v", "position": []}],
        [
            {"key": "b", "value": "v", "position": []},
            {"key": "c", "value": "v", "position": []},
            {"value": "no-key-here", "position": []},
        ],
    ]
    out = normalize_items_to_rows(items)
    assert out[1]["cells"][2]["key"] == "1-2"


def test_cell_non_string_key_coerced_to_placeholder() -> None:
    """cell.key 不是字符串（如数字 / None）→ 占位（避免后端 ID 字段歧义）。"""
    items = [[{"key": 123, "value": "x", "position": []}]]
    out = normalize_items_to_rows(items)
    assert out[0]["cells"][0]["key"] == "0-0"


# --- 防御 / 边界 -------------------------------------------------------------


def test_non_list_input_returns_empty_list() -> None:
    """非 list 输入（None / dict / str）→ 空列表（不要抛异常）。"""
    for bad in (None, {}, "string", 123, {"items": []}):
        assert normalize_items_to_rows(bad) == []


def test_empty_items_returns_empty_list() -> None:
    """空 items → 空列表（不要造一行空行）。"""
    assert normalize_items_to_rows([]) == []


def test_non_list_rows_are_skipped_not_crashed() -> None:
    """items 里有非 list 元素（None / str / dict）→ 跳过那行，其它正常。"""
    items = [
        [{"key": "a", "value": "1", "position": []}],
        None,                       # row 1 跳过
        "string not a row",         # row 2 跳过
        {"key": "dict not a row"},  # row 3 跳过
        [{"key": "z", "value": "9", "position": []}],
    ]
    out = normalize_items_to_rows(items)
    assert [r["row_index"] for r in out] == [0, 4]
    assert out[0]["kv"]["a"] == "1"
    assert out[1]["kv"]["z"] == "9"


def test_non_dict_cells_are_skipped() -> None:
    """cells 里有非 dict 元素（None / str / int）→ 跳过，cells 仍按保留顺序。"""
    items = [
        [
            {"key": "k", "value": "v", "position": []},
            None,
            "string not a cell",
            42,
            {"key": "k2", "value": "v2", "position": []},
        ]
    ]
    out = normalize_items_to_rows(items)
    row = out[0]
    assert [c["key"] for c in row["cells"]] == ["k", "k2"]
    assert row["kv"] == {"k": "v", "k2": "v2"}


def test_position_default_is_empty_list_when_missing() -> None:
    """cell 没 position 字段 → 默认空 list（不返回 None 炸下游）。"""
    items = [[{"key": "k", "value": "v"}]]
    out = normalize_items_to_rows(items)
    assert out[0]["cells"][0]["position"] == []
    assert out[0]["cell_positions"][0]["position"] == []


def test_value_default_is_empty_string_when_missing() -> None:
    """cell 没 value 字段 → 默认空字符串（不是 None，保持下游 isinstance 一致）。"""
    items = [[{"key": "k", "position": []}]]
    out = normalize_items_to_rows(items)
    assert out[0]["cells"][0]["value"] == ""
    assert out[0]["kv"]["k"] == ""

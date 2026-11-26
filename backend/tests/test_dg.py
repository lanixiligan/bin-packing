"""Dangerous goods rules (app.dg): ADG Table 9.1 / 9.2 segregation and Northline acceptance."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app import dg
from app.dg import DgInfo

CASES = json.loads((Path(__file__).parent / "data" / "dg_cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(case):
    """The same cases run in frontend/src/dg/rules.test.ts, so both engines agree."""
    a, b = dg.parse(case["a"]), dg.parse(case["b"])
    assert dg.pair_verdict(a, b).status == case["expect"]
    assert dg.pair_verdict(b, a).status == case["expect"]  # symmetric


def test_matrix_is_symmetric_where_both_are_dg_classes():
    for r, row in dg.MATRIX.items():
        for c, code in zip(dg.COLS, row, strict=True):
            if c in dg.MATRIX:
                assert dg.MATRIX[c][dg.COLS.index(r)] == code, (r, c)


def test_reasons_name_the_rule():
    v = dg.pair_verdict(DgInfo(dg_class="3"), DgInfo(dg_class="5.1"))
    assert v.status == "incompatible" and "Class 3 with Class 5.1" in v.reasons[0]
    v = dg.pair_verdict(DgInfo(food=True), DgInfo(dg_class="6.1"))
    assert 8 in v.exceptions and "exception 8" in v.reasons[0]
    acid, alkali = DgInfo(dg_class="8", t92=["acid_strong"]), DgInfo(dg_class="8", t92=["alkali_strong"])
    v = dg.pair_verdict(acid, alkali)
    assert v.t92 == ["Concentrated strong acids with concentrated strong alkalis"]
    assert 7 in dg.pair_verdict(DgInfo(dg_class="7"), DgInfo(dg_class="9")).exceptions


def test_check_all_reports_pairs():
    dgs = [DgInfo(dg_class="3"), None, DgInfo(dg_class="5.1", t92=[]), DgInfo(dg_class="8")]
    found = {(c.a, c.b, c.status) for c in dg.check_all(dgs)}
    assert found == {(0, 2, "incompatible"), (2, 3, "incompatible")}


@pytest.mark.parametrize("data, message", [
    ({"subsidiary": ["8"]}, "Choose a DG class"),
    ({"food": True, "fire_risk": True}, "both food and fire-risk"),
    ({"dg_class": "3", "food": True}, "can't be marked as food"),
    ({"dg_class": "3", "fire_risk": True}, "Class 6 and 9"),
    ({"dg_class": "8", "subsidiary": ["8"]}, "same as the class"),
    ({"dg_class": "1"}, "division and compatibility group"),
    ({"dg_class": "1", "explosive_code": "1.4"}, "division and compatibility group"),
    ({"dg_class": "3", "explosive_code": "1.4S"}, "only for Class 1"),
    ({"dg_class": "2.1", "packing_group": "II"}, "no packing groups"),
    ({"dg_class": "3", "container": "cylinder"}, "Class 2 gases"),
    ({"dg_class": "8", "t92": ["acid_strong", "alkali_strong"]}, "conflict with each other"),
    ({"dg_class": "6.1", "t92": ["nitromethane"]}, "Nitromethane"),
    ({"dg_class": "3", "un_number": "12"}, "pattern"),
    ({"dg_class": "10"}, "dg_class"),
])
def test_validation(data, message):
    with pytest.raises(ValidationError, match=message):
        DgInfo.model_validate(data)


def test_normalising_and_storage():
    d = DgInfo(dg_class="3", subsidiary=["8", "6.1", "8"], carrier_tags=["fuel"])
    assert d.subsidiary == ["6.1", "8"]
    assert dg.to_json(DgInfo()) is None and dg.to_json(None) is None
    assert dg.to_json(d)["dg_class"] == "3"
    assert dg.label(d) == "Class 3 (sub 6.1, 8)"
    assert dg.label(DgInfo(dg_class="1", explosive_code="1.4S")) == "Class 1.4S"
    assert dg.label(DgInfo(food=True)) == "Food" and dg.label(None) == "General"


# ---- Northline ------------------------------------------------------------------------

def kinds(d: dict) -> set[str]:
    return {i.kind for i in dg.northline_line_issues(DgInfo.model_validate(d))}


@pytest.mark.parametrize("data", [
    {"dg_class": "4.2"}, {"dg_class": "4.3"}, {"dg_class": "6.2"},
    {"dg_class": "3", "packing_group": "I"},
    {"dg_class": "3", "carrier_tags": ["fuel"]},
    {"dg_class": "2.1", "carrier_tags": ["unodourised_lpg"]},
    {"dg_class": "5.1", "carrier_tags": ["peroxide_over_60"]},
    {"dg_class": "7", "un_number": "2915"},
    {"dg_class": "1", "explosive_code": "1.1D"},
    {"dg_class": "1", "explosive_code": "1.3G"},
    {"dg_class": "1", "explosive_code": "1.4B"},
    {"dg_class": "1", "explosive_code": "1.4C", "un_number": "0161"},
])
def test_northline_prohibited(data):
    assert "prohibited" in kinds(data)
    assert dg.northline_prohibited(DgInfo.model_validate(data))


@pytest.mark.parametrize("data", [
    {"dg_class": "2.3"}, {"dg_class": "5.2"}, {"dg_class": "7", "un_number": "2910"},
    {"dg_class": "6.1", "packing_group": "II", "container": "drum"},
    {"dg_class": "9", "carrier_tags": ["env_hazardous"]},
])
def test_northline_needs_approval(data):
    assert kinds(data) >= {"approval"} and "prohibited" not in kinds(data)


@pytest.mark.parametrize("data", [
    {"dg_class": "3", "packing_group": "II"}, {"dg_class": "8", "packing_group": "III"},
    {"dg_class": "6.1", "packing_group": "III"}, {"dg_class": "5.1", "packing_group": "II"},
    {"dg_class": "1", "explosive_code": "1.4C", "un_number": "0509"},
])
def test_northline_accepted(data):
    assert not kinds(data) & {"prohibited", "approval"}


def test_northline_notes_and_limits():
    assert kinds({"dg_class": "2.2", "container": "cylinder"}) == {"note"}
    assert kinds({"dg_class": "9", "carrier_tags": ["lithium_battery"]}) == {"note"}
    solid = DgInfo(dg_class="4.1", packing_group="III")
    lines = [dg.LineRef(solid, 4, 15.0, "Matches"), dg.LineRef(None, 10, 100.0, "Bricks")]
    issues = dg.northline_order_issues(lines)  # 60 kg of 4.1 > 50 kg
    assert [(i, x.kind) for i, x in issues] == [(None, "limit")]
    assert "60 kg" in issues[0][1].message and "50 kg" in issues[0][1].message
    two_lines = [dg.LineRef(solid, 2, 15.0, "Matches"), dg.LineRef(solid, 2, 15.0, "Firelighters")]
    assert dg.northline_order_issues(two_lines)[0][1].kind == "limit"  # summed per order
    assert dg.northline_order_issues([dg.LineRef(solid, 2, 25.0, "Matches")]) == []

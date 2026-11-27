import pytest

from app.planner.axles import estimate_axle_loads
from app.planner.models import Placement
from app.reference.schemas import Deck, Support
from tests.factories import BDOUBLE, PRIME_MOVER, RIGID, SEMI

AU = 1165


def place(deck_id: str, centre_x: float, weight: float, *, n: int = 1, length: int = 1000) -> Placement:
    """A unit whose centre sits `centre_x` mm from the front of its deck."""
    return Placement(unit_id=f"P#{n}", item_id="P", label="", kind="pallet", type_id="AU_STD",
                     deck_id=deck_id, x_mm=round(centre_x - length / 2), y_mm=0, z_mm=0,
                     length_mm=length, width_mm=AU,
                     height_mm=1200, stack_id=n, stack_level=0, weight_kg=weight)


def rows(deck_id: str, deck_length: int, n_rows: int, weight: float,
         only_rows: range | None = None) -> list[Placement]:
    """n_rows x 2 pallets spread evenly along a deck (each row centred in its share of the length)."""
    pitch = deck_length / n_rows
    out: list[Placement] = []
    for r in only_rows if only_rows is not None else range(n_rows):
        centre = (r + 0.5) * pitch
        for _ in range(2):
            out.append(place(deck_id, centre, weight, n=len(out) + 1, length=AU))
    return out


def by_id(loads):
    return {a.group_id: a for a in loads}


def test_empty_semi_is_tare_only():
    loads = estimate_axle_loads(SEMI, [])
    assert [a.group_id for a in loads] == ["steer", "drive", "trailer_tri"]
    for a, g in zip(loads, SEMI.axle_groups, strict=True):
        assert a.load_kg == pytest.approx(g.tare_kg)
        assert a.status == "ok"


def test_load_over_the_tri_goes_fully_to_the_tri():
    loads = by_id(estimate_axle_loads(SEMI, [place("trailer", 15100 - 3700, 10000)]))
    assert loads["trailer_tri"].load_kg == pytest.approx(4800 + 10000)
    assert loads["steer"].load_kg == pytest.approx(4800)
    assert loads["drive"].load_kg == pytest.approx(6000)


def test_load_at_the_kingpin_splits_between_steer_and_drive_by_lever():
    loads = by_id(estimate_axle_loads(SEMI, [place("trailer", 4700 - 3700, 7000)]))
    assert loads["trailer_tri"].load_kg == pytest.approx(4800)
    # Prime mover: steer @1500, drive @5000, kingpin @4700
    assert loads["drive"].load_kg == pytest.approx(6000 + 7000 * 3200 / 3500)
    assert loads["steer"].load_kg == pytest.approx(4800 + 7000 * 300 / 3500)


def test_22_tonnes_uniform_on_semi_is_within_gml():
    loads = estimate_axle_loads(SEMI, rows("trailer", 13600, 11, 1000))
    assert sum(a.load_kg for a in loads) == pytest.approx(SEMI.tare_kg + 22000)
    for a in loads:
        assert a.status != "over"
        assert a.load_kg <= a.limit_kg


def test_heavy_rear_puts_the_tri_over_gml():
    loads = by_id(estimate_axle_loads(SEMI, rows("trailer", 13600, 11, 1800, only_rows=range(5, 11))))
    tri = loads["trailer_tri"]
    assert tri.load_kg > 20000
    assert tri.status == "over"
    assert tri.ratio > 1


def test_hml_raises_the_limit():
    placements = [place("trailer", 15100 - 3700, 16000)]  # tri carries 20.8 t
    gml = by_id(estimate_axle_loads(SEMI, placements, "GML"))["trailer_tri"]
    hml = by_id(estimate_axle_loads(SEMI, placements, "HML"))["trailer_tri"]
    assert gml.load_kg == hml.load_kg == pytest.approx(20800)
    assert (gml.limit_kg, gml.status) == (20000, "over")
    assert (hml.limit_kg, hml.status) == (22500, "near")


def test_near_status_from_90_percent():
    loads = by_id(estimate_axle_loads(RIGID, [place("body", 5800 - 2300, 8000 - 2300 + 100)]))
    # Rear single: 2300 tare + 5800 = 8100 of 9000 = 0.9
    assert loads["rear"].load_kg == pytest.approx(8100)
    assert loads["rear"].status == "near"


def test_bdouble_chains_rear_to_lead_to_prime_mover():
    # A point load at the rear trailer's kingpin goes entirely onto the lead deck at x=11,600,
    # which overhangs the lead tri (x=10,200): the lead tri takes more than the load, the prime
    # mover is lifted.
    loads = by_id(estimate_axle_loads(BDOUBLE, [place("rear", 11600 - 11200, 10000)]))
    assert loads["rear_tri"].load_kg == pytest.approx(4700)
    lead_share = 10000 * (11600 - 4700) / (10200 - 4700)
    assert loads["lead_tri"].load_kg == pytest.approx(4500 + lead_share)
    kingpin = 10000 - lead_share  # negative: lift
    assert kingpin < 0
    assert loads["drive"].load_kg == pytest.approx(6000 + kingpin * 3200 / 3500)
    assert loads["steer"].load_kg == pytest.approx(4800 + kingpin * 300 / 3500)


def test_bdouble_conserves_weight():
    placements = rows("lead", 7400, 6, 900) + rows("rear", 13600, 11, 750)
    loads = estimate_axle_loads(BDOUBLE, placements)
    tare = sum(g.tare_kg for g in BDOUBLE.axle_groups)
    cargo = sum(p.weight_kg for p in placements)
    assert sum(a.load_kg for a in loads) == pytest.approx(tare + cargo)
    assert [a.group_id for a in loads] == ["steer", "drive", "lead_tri", "rear_tri"]


def test_cycle_is_detected():
    a = Deck(id="a", name="A", x_mm=0, length_mm=5000, width_mm=2400, deck_height_mm=1000,
             front_support=Support(position_mm=500, on_deck="b"),
             rear_support=Support(position_mm=4500, axle_group="steer"))
    b = Deck(id="b", name="B", x_mm=5000, length_mm=5000, width_mm=2400, deck_height_mm=1000,
             front_support=Support(position_mm=5500, on_deck="a"),
             rear_support=Support(position_mm=9500, axle_group="drive"))
    cyclic = SEMI.model_copy(update={"decks": [PRIME_MOVER, a, b]})
    with pytest.raises(ValueError, match="cycle"):
        estimate_axle_loads(cyclic, [])


def test_unknown_deck_is_rejected():
    with pytest.raises(ValueError):
        estimate_axle_loads(SEMI, [place("nowhere", 100, 500)])

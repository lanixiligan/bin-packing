"""
Dangerous goods (DG): ADG Code segregation and Northline acceptance rules.

Pure functions, no database. The same rules are ported to the frontend in
frontend/src/dg/rules.ts; tests/data/dg_cases.json is checked by both test
suites so the two stay in step.

Source: ADG Code Table 9.1 and Table 9.2 as published in Edition 7.8
(Edition 7.9 is mandatory from 1 October 2025: verify the matrix against the
edition that applies). Northline rules: GDE-56 "Dangerous Goods - types we
carry", Rev 5.0 (26/09/25).

Model
-----
An item's DG data is a `DgInfo` (or None for general freight). Two items are
checked by pairing every hazard of one (primary class and subsidiary hazards;
or "food" / "fire-risk" for non-DG goods) with every hazard of the other and
looking each pair up in Table 9.1. The exceptions refine the result:

  1  explosives: incompatible with all other DG, food and fire-risk goods
  2  2.1 x 3: incompatible only if BOTH are in receptacles > 500 L
  3/4 2.1 or 2.3 x a 2.2 gas with subsidiary 5.1: incompatible unless all
     gases are in cylinders / pressure drums of 500 L or less
  5  Class 5 x Class 6/9: incompatible if the 6/9 goods are fire-risk
  6  specific goods (Table 9.2): decided by the items' `t92` tags; if a tag
     list was not filled in, the result is "check" (a warning, not a block)
  7  Class 7: a note only
  8  food x 2.3, 6, 7, 8: incompatible

Two items with identical DG data never conflict (it is one product).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

DgClass = Literal["1", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2",
                  "6.1", "6.2", "7", "8", "9"]
Subsidiary = Literal["2.1", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "6.1", "8"]
PackingGroup = Literal["I", "II", "III"]
Container = Literal["package", "drum", "ibc", "cylinder", "aerosol", "tank_over_500l"]
T92Tag = Literal[
    "ammonium_nitrate", "tetranitromethane", "chloroisocyanuric_acid", "chloroisocyanurate",
    "bromate_chlorate_chlorite", "hypochlorite", "inorganic_nitrite", "calcium_hypochlorite",
    "nitromethane", "acid_strong", "acid_other", "alkali_strong", "cyanide",
]
CarrierTag = Literal["fuel", "unodourised_lpg", "peroxide_over_60", "env_hazardous", "lithium_battery"]
RuleSet = Literal["adg", "northline"]

DG_CLASSES: tuple[str, ...] = ("1", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2",
                               "6.1", "6.2", "7", "8", "9")
CLASS_NAMES = {
    "1": "Explosives", "2.1": "Flammable gas", "2.2": "Non-flammable, non-toxic gas",
    "2.3": "Toxic gas", "3": "Flammable liquid", "4.1": "Flammable solid",
    "4.2": "Spontaneously combustible", "4.3": "Dangerous when wet", "5.1": "Oxidising substance",
    "5.2": "Organic peroxide", "6.1": "Toxic substance", "6.2": "Infectious substance",
    "7": "Radioactive", "8": "Corrosive", "9": "Miscellaneous DG",
}
# Classes that have packing groups (1, 2.x, 5.2 and 7 do not).
NO_PACKING_GROUP = {"1", "2.1", "2.2", "2.3", "5.2", "7"}
EXPLOSIVE_CODE_RE = re.compile(r"^1\.[1-6][A-HJ-LNS]$")


# ---------------------------------------------------------------------------
# Table 9.1 (rows: DG classes; columns: DG classes, F = food, R = fire-risk)
# ---------------------------------------------------------------------------

COLS = ("1", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2", "6", "7", "8", "9", "F", "R")
MATRIX: dict[str, tuple[str, ...]] = {
    "1":   ("(1)",) * 16,
    "2.1": ("(1)", "0", "0(3)", "0", "0(2)", "N", "N", "N", "N", "N", "0", "N", "0", "0", "0", "0"),
    "2.2": ("(1)", "0(3)", "0", "0(4)", "0", "0", "N", "0", "0", "N", "0", "0", "0", "0", "0", "0"),
    "2.3": ("(1)", "0", "0(4)", "0", "N", "0", "N", "0", "N", "N", "0", "0", "0", "0", "N(8)", "0"),
    "3":   ("(1)", "0(2)", "0", "N", "0", "0", "N", "0", "N", "N", "0(6)", "N", "0", "0", "0", "0"),
    "4.1": ("(1)", "N", "0", "0", "0", "0", "N", "0", "N", "N", "0", "N", "0", "0", "0", "0"),
    "4.2": ("(1)", "N", "N", "N", "N", "N", "0", "0", "N", "N", "0", "N", "0", "0", "0", "0"),
    "4.3": ("(1)", "N", "0", "0", "0", "0", "0", "0", "N", "N", "0", "N", "N", "0", "0", "0"),
    "5.1": ("(1)", "N", "0", "N", "N", "N", "N", "N", "0(6)", "N", "0(5)", "N", "N", "0(5)", "0", "N"),
    "5.2": ("(1)", "N", "N", "N", "N", "N", "N", "N", "N", "0", "0(5)", "N", "N", "0(5)", "0", "N"),
    "6":   ("(1)", "0", "0", "0", "0(6)", "0", "0", "0", "0(5)", "0(5)", "0", "0", "0(6)", "0", "N(8)", "0"),
    "7":   ("(1)", "N", "0", "0", "N", "N", "N", "N", "N", "N", "0", "0", "N", "0", "N(8)", "0"),
    "8":   ("(1)", "0", "0", "0", "0", "0", "0", "N", "N", "N", "0(6)", "N", "0(6)", "0", "N(8)", "0"),
    "9":   ("(1)", "0", "0", "0", "0", "0", "0", "0", "0(5)", "0(5)", "0", "0", "0", "0", "0", "0"),
}

EXCEPTIONS = {
    1: "Explosives are incompatible with all other dangerous goods in all quantities. Exceptions: "
       "the Australian Explosives Code, and Division 1.4S where 9.1.2.2.2 applies.",
    2: "Division 2.1 and Class 3 are incompatible if both are in tanks or other receptacles with an "
       "individual capacity of more than 500 L.",
    3: "Division 2.1 is incompatible with Division 2.2 gases that have subsidiary hazard 5.1. "
       "Exception: all gases are in cylinders or pressure drums of 500 L capacity or less.",
    4: "Division 2.3 is incompatible with Division 2.2 gases that have subsidiary hazard 5.1. "
       "Exception: all gases are in cylinders or pressure drums of 500 L capacity or less.",
    5: "Class 5 is incompatible with Class 6 or Class 9 goods that are fire-risk substances.",
    6: "Some specific goods in these classes are incompatible. See Table 9.2.",
    7: "For Class 7 with undeveloped photographic film, personnel and mail, see the Code of Practice "
       "for the Safe Transport of Radioactive Substances.",
    8: "Food and food packagings are incompatible with these classes in all quantities. "
       "Exception (9.1.2.3): Class 8 food ingredients for the manufacture of food.",
}

# Table 9.2 as tag pairs. Nitromethane vs Class 6 is class-based (see _t92_conflicts).
_OXIDISER_SALTS = ("bromate_chlorate_chlorite", "hypochlorite", "calcium_hypochlorite",
                   "chloroisocyanurate", "inorganic_nitrite")
T92_RULES: tuple[tuple[frozenset[str], frozenset[str], str], ...] = (
    (frozenset({"ammonium_nitrate"}), frozenset({"tetranitromethane"}),
     "Ammonium nitrate with tetranitromethane"),
    (frozenset({"chloroisocyanuric_acid"}), frozenset(_OXIDISER_SALTS),
     "Dichloro- or trichloroisocyanuric acid with a bromate, chlorate, chlorite, hypochlorite, "
     "chloroisocyanurate or inorganic nitrite"),
    (frozenset({"calcium_hypochlorite"}),
     frozenset({"ammonium_nitrate", "chloroisocyanuric_acid", "chloroisocyanurate"}),
     "Calcium hypochlorite with ammonium nitrate, chloroisocyanuric acid or a chloroisocyanurate"),
    (frozenset({"acid_strong"}), frozenset({"alkali_strong"}),
     "Concentrated strong acids with concentrated strong alkalis"),
    (frozenset({"cyanide"}), frozenset({"acid_strong", "acid_other"}),
     "Cyanide compounds (Class 6.1) with acids (Class 8)"),
)
NITROMETHANE_RULE = "Class 6 goods with nitromethane (Class 3)"


# ---------------------------------------------------------------------------
# DgInfo
# ---------------------------------------------------------------------------

class DgInfo(BaseModel):
    """
    Dangerous goods data of an item (copied onto each order line). `dg_class`
    null = not dangerous goods; then only `food` / `fire_risk` matter.
    """
    model_config = ConfigDict(extra="forbid")

    dg_class: DgClass | None = None
    subsidiary: list[Subsidiary] = Field(default_factory=list, max_length=4)
    packing_group: PackingGroup | None = None
    un_number: str | None = Field(default=None, pattern=r"^\d{4}$", description="4 digits, e.g. '1263'")
    explosive_code: str | None = Field(default=None, description="Class 1 only: division and "
                                                                 "compatibility group, e.g. '1.4S'")
    container: Container = "package"
    t92: list[T92Tag] | None = Field(
        default=None, description="Table 9.2 specific goods. null = not answered (gives a "
                                  "'check' warning against classes Table 9.2 covers); [] = none apply.")
    carrier_tags: list[CarrierTag] = Field(default_factory=list)
    food: bool = Field(default=False, description="Food or food packaging (not DG).")
    fire_risk: bool = Field(default=False, description="Fire-risk substance: a non-DG combustible "
                                                       "liquid, or Class 6/9 goods (exception 5).")

    @field_validator("subsidiary", "carrier_tags")
    @classmethod
    def _sorted_unique(cls, v: list[str]) -> list[str]:
        return sorted(set(v))

    @field_validator("t92")
    @classmethod
    def _sorted_unique_t92(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else sorted(set(v))

    @model_validator(mode="after")
    def _consistent(self) -> DgInfo:
        c = self.dg_class
        if c is None:
            if self.subsidiary or self.packing_group or self.un_number or self.explosive_code \
                    or self.t92 or self.carrier_tags:
                raise ValueError("Choose a DG class before you add DG details, or clear them.")
            if self.food and self.fire_risk:
                raise ValueError("An item can't be both food and fire-risk goods.")
            self.container = "package"
            self.t92 = None
            return self
        if self.food:
            raise ValueError("Dangerous goods can't be marked as food.")
        if self.fire_risk and c[0] not in "69":
            raise ValueError("'Fire-risk' applies to goods that aren't DG, or to Class 6 and 9 goods "
                             "(exception 5). Other classes already carry their own fire risk.")
        if c in self.subsidiary:
            raise ValueError(f"A subsidiary hazard can't be the same as the class ({c}).")
        if c == "1":
            if not self.explosive_code or not EXPLOSIVE_CODE_RE.match(self.explosive_code):
                raise ValueError("Class 1 needs the division and compatibility group, e.g. 1.4S.")
        elif self.explosive_code:
            raise ValueError("The explosive code is only for Class 1.")
        if c in NO_PACKING_GROUP and self.packing_group:
            raise ValueError(f"Class {c} has no packing groups.")
        if self.container in ("cylinder", "aerosol") and not c.startswith("2"):
            raise ValueError("Cylinders and aerosols are for Class 2 gases.")
        tags = set(self.t92 or ())
        for left, right, text in T92_RULES:
            if tags & left and tags & right:
                raise ValueError(f"These Table 9.2 tags conflict with each other: {text}.")
        if "nitromethane" in tags and "6" in _codes(self):
            raise ValueError("Nitromethane can't be Class 6 goods (Table 9.2).")
        return self

    def key(self) -> str:
        """Stable identity: equal keys = the same DG profile."""
        return self.model_dump_json()


def parse(value: DgInfo | dict | None) -> DgInfo | None:
    """A DgInfo from a stored JSON dict (JSONB column) or None."""
    if value is None or isinstance(value, DgInfo):
        return value
    return DgInfo.model_validate(value)


def to_json(dg: DgInfo | None) -> dict | None:
    """What to store in an `items.dg` / `order_lines.dg` column (None for general freight)."""
    return None if is_general(dg) else dg.model_dump(mode="json")


def is_general(dg: DgInfo | None) -> bool:
    """General freight: not DG, not food, not fire-risk."""
    return dg is None or (dg.dg_class is None and not dg.food and not dg.fire_risk)


def label(dg: DgInfo | None) -> str:
    """Short text: 'Class 3', 'Class 5.1 (sub 8)', 'Class 1.4S', 'Food', 'Fire-risk', 'General'."""
    if dg is None or dg.dg_class is None:
        if dg is not None and dg.food:
            return "Food"
        if dg is not None and dg.fire_risk:
            return "Fire-risk"
        return "General"
    code = dg.explosive_code if dg.dg_class == "1" and dg.explosive_code else dg.dg_class
    main = f"Class {code}"
    if dg.subsidiary:
        main += f" (sub {', '.join(dg.subsidiary)})"
    return main


# ---------------------------------------------------------------------------
# Segregation
# ---------------------------------------------------------------------------

def _table_code(cls: str) -> str:
    return "6" if cls.startswith("6") else cls


def _codes(dg: DgInfo) -> list[str]:
    return [_table_code(c) for c in ([dg.dg_class] if dg.dg_class else []) + list(dg.subsidiary)]


@dataclass(frozen=True)
class _Hazard:
    code: str    # a COLS value
    role: str    # "primary" | "subsidiary" | "" (food / fire-risk)


def _hazards(dg: DgInfo | None) -> list[_Hazard]:
    if dg is None:
        return []
    if dg.dg_class is None:
        if dg.food:
            return [_Hazard("F", "")]
        if dg.fire_risk:
            return [_Hazard("R", "")]
        return []
    out = [_Hazard(_table_code(dg.dg_class), "primary")]
    out += [_Hazard(_table_code(s), "subsidiary") for s in dg.subsidiary]
    return out


def lookup(a: str, b: str) -> str:
    """Table 9.1 code for two hazard codes (at least one a DG class)."""
    if a in MATRIX:
        return MATRIX[a][COLS.index(b)]
    return MATRIX[b][COLS.index(a)]


def _hazard_text(h: _Hazard) -> str:
    if h.code == "F":
        return "food"
    if h.code == "R":
        return "fire-risk goods"
    return f"Class {h.code}" + (" (subsidiary)" if h.role == "subsidiary" else "")


@dataclass
class PairVerdict:
    status: Literal["ok", "incompatible", "check"] = "ok"
    reasons: list[str] = field(default_factory=list)      # why incompatible / what to check
    exceptions: list[int] = field(default_factory=list)   # exception numbers that applied
    t92: list[str] = field(default_factory=list)          # Table 9.2 entries involved

    def _raise(self, status: str) -> None:
        rank = {"ok": 0, "check": 1, "incompatible": 2}
        if rank[status] > rank[self.status]:
            self.status = status  # type: ignore[assignment]


def _t92_conflicts(a: DgInfo, b: DgInfo) -> list[str]:
    ta, tb = set(a.t92 or ()), set(b.t92 or ())
    out = []
    for left, right, text in T92_RULES:
        if (ta & left and tb & right) or (tb & left and ta & right):
            out.append(text)
    if ("nitromethane" in ta and "6" in _codes(b)) or ("nitromethane" in tb and "6" in _codes(a)):
        out.append(NITROMETHANE_RULE)
    return out


def pair_verdict(a: DgInfo | None, b: DgInfo | None) -> PairVerdict:
    """Can goods with DG data `a` and `b` travel on the same vehicle (ADG Table 9.1 / 9.2)?"""
    v = PairVerdict()
    if a is not None and b is not None and a.key() == b.key():
        return v  # the same product
    ha, hb = _hazards(a), _hazards(b)
    if not ha or not hb:
        return v  # general freight goes with anything

    # Exception 1: explosives.
    if a.dg_class == "1" or b.dg_class == "1":
        v.exceptions.append(1)
        if a.dg_class == "1" and b.dg_class == "1":
            if a.explosive_code[-1] == b.explosive_code[-1]:
                v._raise("check")
                v.reasons.append(f"Explosives {a.explosive_code} and {b.explosive_code}: check the "
                                 "Australian Explosives Code before loading them together.")
            else:
                v._raise("incompatible")
                v.reasons.append(f"Explosives {a.explosive_code} and {b.explosive_code} have different "
                                 "compatibility groups (Australian Explosives Code).")
        else:
            v._raise("incompatible")
            v.reasons.append("Explosives are incompatible with all other dangerous goods, food and "
                             "fire-risk goods (exception 1).")
        return v

    # Table 9.2 tag conflicts are decided regardless of the cell.
    t92 = _t92_conflicts(a, b) if a.dg_class and b.dg_class else []
    if t92:
        v._raise("incompatible")
        v.exceptions.append(6)
        v.t92 = t92
        v.reasons += [f"{t} (Table 9.2)." for t in t92]

    def governs_34(x: _Hazard, x_dg: DgInfo, y: _Hazard, y_dg: DgInfo) -> bool:
        # 2.1/2.3 primary vs the 5.1 subsidiary of a 2.2 gas: exception 3/4 on the primary cell decides.
        return (x.role == "primary" and x.code in ("2.1", "2.3") and y_dg.dg_class == "2.2"
                and y.role == "subsidiary" and y.code == "5.1")

    for x in ha:
        for y in hb:
            if x.code in ("F", "R") and y.code in ("F", "R"):
                continue
            if governs_34(x, a, y, b) or governs_34(y, b, x, a):
                continue
            k = lookup(x.code, y.code)
            pair = f"{_hazard_text(x)} with {_hazard_text(y)}"
            m = re.match(r"^(0|N)\((\d)\)$", k)
            exc = int(m.group(2)) if m else None
            if exc and exc not in v.exceptions:
                v.exceptions.append(exc)
            if k.startswith("N"):
                v._raise("incompatible")
                v.reasons.append(f"{pair}: incompatible (Table 9.1{', exception 8' if exc == 8 else ''}).")
            elif exc == 2:
                if a.container == "tank_over_500l" and b.container == "tank_over_500l":
                    v._raise("incompatible")
                    v.reasons.append(f"{pair}: both in receptacles over 500 L (exception 2).")
            elif exc in (3, 4):
                gas = a if (x.code == "2.2" and x.role == "primary") else b
                if "5.1" in gas.subsidiary and "tank_over_500l" in (a.container, b.container):
                    v._raise("incompatible")
                    v.reasons.append(f"{pair}: oxidising 2.2 gas and the other gas are not all in "
                                     f"cylinders of 500 L or less (exception {exc}).")
            elif exc == 5:
                other = a if x.code in ("6", "9") else b
                if other.fire_risk:
                    v._raise("incompatible")
                    v.reasons.append(f"{pair}: the Class {other.dg_class} goods are fire-risk "
                                     "substances (exception 5).")
            elif exc == 6 and not t92:
                if a.t92 is None or b.t92 is None:
                    v._raise("check")
                    v.reasons.append(f"{pair}: check Table 9.2 (specific goods not recorded on the item).")

    if "7" in (_table_code(a.dg_class or ""), _table_code(b.dg_class or "")) and 7 not in v.exceptions:
        v.exceptions.append(7)
    v.exceptions.sort()
    return v


def conflicts(a: DgInfo | None, b: DgInfo | None) -> bool:
    """True if the goods must not travel on the same vehicle."""
    return pair_verdict(a, b).status == "incompatible"


@dataclass
class Conflict:
    a: int                  # index into the input sequence
    b: int
    status: Literal["incompatible", "check"]
    reasons: list[str]


def check_all(dgs: Sequence[DgInfo | None]) -> list[Conflict]:
    """Every pair of `dgs` that is incompatible or needs a Table 9.2 check (i < j)."""
    out: list[Conflict] = []
    cache: dict[tuple[str, str], PairVerdict] = {}
    for i in range(len(dgs)):
        for j in range(i + 1, len(dgs)):
            a, b = dgs[i], dgs[j]
            if is_general(a) or is_general(b):
                continue
            key = (a.key(), b.key())
            if key not in cache:
                cache[key] = pair_verdict(a, b)
            v = cache[key]
            if v.status != "ok":
                out.append(Conflict(i, j, v.status, v.reasons))
    return out


# ---------------------------------------------------------------------------
# Northline acceptance (GDE-56)
# ---------------------------------------------------------------------------

IssueKind = Literal["prohibited", "limit", "approval", "note"]


@dataclass
class Issue:
    kind: IssueKind
    message: str


def northline_limit(dg: DgInfo | None) -> tuple[str, float] | None:
    """(category, max kg per consignment) if Northline limits the quantity."""
    if dg is None or dg.dg_class is None:
        return None
    if dg.dg_class == "4.1":
        return "Division 4.1", 50.0
    if dg.dg_class == "1" and dg.explosive_code:
        if dg.explosive_code == "1.3C":
            return "Division 1.3C", 50.0
        if dg.explosive_code in ("1.4G", "1.4C"):
            return f"Division {dg.explosive_code}", 250.0
    return None


def northline_line_issues(dg: DgInfo | None) -> list[Issue]:
    """Northline's rules for one item (prohibitions, approvals and notes; limits: northline_limit)."""
    if dg is None or dg.dg_class is None:
        return []
    c, out = dg.dg_class, []

    def bad(msg: str) -> None:
        out.append(Issue("prohibited", msg))

    if dg.packing_group == "I":
        bad("Northline does not transport Packing Group I goods.")
    if c == "1":
        code = dg.explosive_code or ""
        div, grp = code[:3], code[3:]
        if div in ("1.1", "1.2", "1.5", "1.6"):
            bad(f"Northline does not transport Division {div}.")
        elif div == "1.3" and grp != "C":
            bad(f"Northline does not accept Division {code}.")
        elif div == "1.4":
            if grp == "S":
                out.append(Issue("note", "1.4S: for manufacturers or distributors only; transport "
                                         "outside the Northline network is not permitted."))
            elif grp == "G":
                out.append(Issue("note", "1.4G fireworks travel only within the Northern Territory."))
            elif grp == "C":
                if dg.un_number != "0509":
                    bad("For Division 1.4C Northline transports UN 0509 only.")
            else:
                bad(f"Northline does not accept Division {code}.")
    elif c in ("4.2", "4.3", "6.2"):
        bad(f"Northline does not transport Division {c}.")
    elif c == "2.1" and "unodourised_lpg" in dg.carrier_tags:
        bad("Northline does not accept unodourised propane, butane or LPG.")
    elif c == "3" and "fuel" in dg.carrier_tags:
        bad("Northline does not accept fuels (petrol, race fuel, Avgas).")
    elif c == "5.1" and "peroxide_over_60" in dg.carrier_tags:
        bad("Northline does not accept products with a peroxide concentration over 60%.")
    elif c == "7" and dg.un_number not in ("2910", "2911"):
        bad("For Class 7 Northline transports UN 2910 and UN 2911 only.")

    if not out or all(i.kind != "prohibited" for i in out):
        if approval_required(dg):
            out.append(Issue("approval", "Needs approval from the Northline National HSEQ Team "
                                         "(Safety@northline.com.au)."))
    if c.startswith("2") and dg.container == "cylinder":
        out.append(Issue("note", "Gas cylinders travel in a steel cage only, also when empty."))
    if "lithium_battery" in dg.carrier_tags:
        out.append(Issue("note", "Batteries must meet Northline GDE-55 Transport of Lithium Batteries."))
    return out


def approval_required(dg: DgInfo | None) -> bool:
    """Northline 'Needs approval' goods."""
    if dg is None or dg.dg_class is None:
        return False
    c = dg.dg_class
    if c in ("2.3", "5.2", "7"):
        return True
    if c == "6.1":
        return dg.container in ("drum", "ibc", "tank_over_500l") or dg.packing_group not in ("II", "III")
    if c == "9":
        return "env_hazardous" in dg.carrier_tags
    return False


def northline_prohibited(dg: DgInfo | None) -> bool:
    return any(i.kind == "prohibited" for i in northline_line_issues(dg))


@dataclass
class LineRef:
    """What the Northline order check needs to know about an order line."""
    dg: DgInfo | None
    quantity: int
    unit_weight_kg: float
    name: str


def northline_order_issues(lines: Iterable[LineRef]) -> list[tuple[int | None, Issue]]:
    """(line index or None for an order-level limit, issue) for one consignment (order)."""
    lines = list(lines)
    out: list[tuple[int | None, Issue]] = []
    totals: dict[str, tuple[float, float]] = {}
    for i, ln in enumerate(lines):
        for issue in northline_line_issues(ln.dg):
            out.append((i, issue))
        lim = northline_limit(ln.dg)
        if lim:
            cat, max_kg = lim
            kg, _ = totals.get(cat, (0.0, max_kg))
            totals[cat] = (kg + ln.unit_weight_kg * ln.quantity, max_kg)
    for cat, (kg, max_kg) in totals.items():
        if kg > max_kg + 1e-9:
            out.append((None, Issue("limit", f"{cat}: {kg:,.3g} kg in this order; Northline accepts "
                                             f"at most {max_kg:g} kg.")))
    return out

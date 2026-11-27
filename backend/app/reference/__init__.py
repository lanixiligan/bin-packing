"""
Reference data, the single source of truth for pallets, containers, bodies and vehicles.

The frontend reads it from GET /api/reference and never keeps its own copy.
All values are typical industry values: override them with `load_reference(overrides)`.

Overrides are deep-merged onto the defaults (dicts merge key by key, lists and scalars replace)
and the result is re-validated. A key that isn't in the defaults adds a new entry, which must
validate in full (its `id` defaults to the key). The cached defaults are never modified.
"""

import copy
from functools import lru_cache
from typing import Any

from app.reference.bodies import BODIES
from app.reference.containers import CONTAINERS
from app.reference.pallets import PALLET_DEFAULTS, PALLETS
from app.reference.schemas import Deck, ReferenceData, ReferenceOverrides
from app.reference.vehicles import VEHICLES

_KEYED_SECTIONS = ("pallets", "containers", "bodies", "vehicles")


@lru_cache(maxsize=1)
def _defaults() -> ReferenceData:
    ref = ReferenceData(pallets=PALLETS, pallet_defaults=PALLET_DEFAULTS, containers=CONTAINERS,
                        bodies=BODIES, vehicles=VEHICLES)
    check_integrity(ref)
    return ref


def load_reference(overrides: ReferenceOverrides | dict | None = None) -> ReferenceData:
    """The default reference data, with `overrides` deep-merged and re-validated.

    Raises ValueError (or pydantic's ValidationError, a ValueError subclass) for bad overrides.
    """
    if overrides is None:
        return _defaults()
    return apply_overrides(_defaults(), overrides)


def apply_overrides(ref: ReferenceData, overrides: ReferenceOverrides | dict) -> ReferenceData:
    """A new ReferenceData: `overrides` deep-merged onto `ref` and re-validated. `ref` is unchanged."""
    if not isinstance(overrides, ReferenceOverrides):
        overrides = ReferenceOverrides.model_validate(overrides)
    sections = {name: getattr(overrides, name) for name in ReferenceOverrides.model_fields}
    if all(patch is None for patch in sections.values()):
        return ref

    data = ref.model_dump()
    for name, patch in sections.items():
        if patch is None:
            continue
        if name == "pallet_defaults":
            data[name] = _deep_merge(data[name], patch)
            continue
        for key, entry in patch.items():
            base = data[name].get(key)
            merged = _deep_merge(base, entry) if base is not None else {"id": key, **copy.deepcopy(entry)}
            if merged.get("id") != key:
                raise ValueError(f"{name}.{key}: id '{merged.get('id')}' must match its key '{key}'.")
            data[name][key] = merged

    result = ReferenceData.model_validate(data)
    check_integrity(result)
    return result


def _deep_merge(base: Any, patch: Any) -> Any:
    """Dicts merge recursively; anything else (lists included) is replaced by a copy of `patch`."""
    if isinstance(base, dict) and isinstance(patch, dict):
        out = dict(base)
        for k, v in patch.items():
            out[k] = _deep_merge(base.get(k), v)
        return out
    return copy.deepcopy(patch)


def check_integrity(ref: ReferenceData) -> None:
    """Cross-references the schema alone can't check. Raises ValueError on the first problem."""
    for name in _KEYED_SECTIONS:
        for key, entry in getattr(ref, name).items():
            if entry.id != key:
                raise ValueError(f"{name}.{key}: id '{entry.id}' must match its key.")
    if ref.pallet_defaults.default_pallet not in ref.pallets:
        raise ValueError(f"pallet_defaults.default_pallet '{ref.pallet_defaults.default_pallet}' is unknown.")

    for v in ref.vehicles.values():
        where = f"vehicles.{v.id}"
        for body in [*v.allowed_bodies, v.default_body]:
            if body not in ref.bodies:
                raise ValueError(f"{where}: unknown body '{body}'.")
        if v.default_body not in v.allowed_bodies:
            raise ValueError(f"{where}: default_body '{v.default_body}' isn't in allowed_bodies.")

        decks = {d.id: d for d in v.decks}
        groups = {g.id for g in v.axle_groups}
        if len(decks) != len(v.decks) or len(groups) != len(v.axle_groups):
            raise ValueError(f"{where}: deck and axle group ids must be unique.")
        for d in v.decks:
            for s in (d.front_support, d.rear_support):
                if s.axle_group is not None and s.axle_group not in groups:
                    raise ValueError(f"{where}.{d.id}: unknown axle group '{s.axle_group}'.")
                if s.on_deck is not None and s.on_deck not in decks:
                    raise ValueError(f"{where}.{d.id}: unknown deck '{s.on_deck}'.")
            if d.front_support.position_mm == d.rear_support.position_mm:
                raise ValueError(f"{where}.{d.id}: the two supports can't be at the same x.")
        for d in v.decks:
            _check_no_loop(d.id, decks, (), where)

        for combo in v.container_combos:
            for slot in combo.slots:
                if slot.deck_id not in decks or not decks[slot.deck_id].cargo:
                    raise ValueError(f"{where}: combo '{combo.name}' uses unknown cargo deck "
                                     f"'{slot.deck_id}'.")


def _check_no_loop(deck_id: str, decks: dict[str, Deck], path: tuple[str, ...], where: str) -> None:
    """Chains of couplings (a deck resting on a deck) must end on axle groups."""
    if deck_id in path:
        raise ValueError(f"{where}: decks rest on each other in a loop ({' -> '.join((*path, deck_id))}).")
    d = decks[deck_id]
    for s in (d.front_support, d.rear_support):
        if s.on_deck is not None:
            _check_no_loop(s.on_deck, decks, (*path, deck_id), where)


__all__ = ["ReferenceData", "ReferenceOverrides", "apply_overrides", "check_integrity", "load_reference"]

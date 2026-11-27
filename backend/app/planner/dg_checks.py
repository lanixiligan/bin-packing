"""
Dangerous goods checks for one vehicle, using app/dg.py (ADG Code Table 9.1 / 9.2 and Northline's
acceptance rules).

The planner plans a single vehicle, so the rule applied is the strict one: goods that ADG marks
incompatible must not travel on the same vehicle. ADG also allows some incompatible goods on one
vehicle when they are separated by distance or a segregation device; that isn't modelled, and the
suggestion says so. Results are for planning: the consignor and driver remain responsible for
segregation, placarding and documents.
"""

from app import dg as dgrules
from app.planner.models import FreightItem, PlanWarning


def _name(item: FreightItem) -> str:
    return f'"{item.label}"' if item.label else f'"{item.id}"'


def dg_warnings(items: list[FreightItem], rule_set: dgrules.RuleSet = "adg") -> list[PlanWarning]:
    out: list[PlanWarning] = []
    dg_items = [it for it in items if not dgrules.is_general(it.dg)]
    if not dg_items:
        return out

    classes = sorted({it.dg.dg_class for it in dg_items if it.dg and it.dg.dg_class},
                     key=dgrules.DG_CLASSES.index)
    if classes:
        out.append(PlanWarning(
            code="DG_ON_BOARD", severity="info",
            message=f"This load carries dangerous goods (Class {', '.join(classes)}).",
            suggestion="Check placard loads, the transport documents and the driver's DG licence "
                       "requirements under the ADG Code.",
            item_ids=[it.id for it in dg_items if it.dg and it.dg.dg_class]))

    # Segregation: every pair of lines (identical DG profiles never conflict).
    for c in dgrules.check_all([it.dg for it in dg_items]):
        a, b = dg_items[c.a], dg_items[c.b]
        pair = f"{_name(a)} ({dgrules.label(a.dg)}) and {_name(b)} ({dgrules.label(b.dg)})"
        reason = " ".join(c.reasons)
        if c.status == "incompatible":
            out.append(PlanWarning(
                code="DG_INCOMPATIBLE", severity="error",
                message=f"{pair} can't travel on the same vehicle. {reason}",
                suggestion="Split them into separate loads. (ADG allows some pairs on one vehicle with "
                           "segregation devices or distance; this planner doesn't model that.)",
                item_ids=[a.id, b.id]))
        else:
            out.append(PlanWarning(
                code="DG_CHECK", severity="warning",
                message=f"Check {pair} before loading them together. {reason}",
                suggestion="Record the Table 9.2 goods on both lines, or confirm with your DG adviser.",
                item_ids=[a.id, b.id]))

    if rule_set == "northline":
        lines = [dgrules.LineRef(dg=it.dg, quantity=it.quantity, unit_weight_kg=it.gross_weight_kg,
                                 name=it.label or it.id) for it in items]
        for index, issue in dgrules.northline_order_issues(lines):
            ids = [items[index].id] if index is not None else []
            who = f"{_name(items[index])}: " if index is not None else ""
            if issue.kind in ("prohibited", "limit"):
                out.append(PlanWarning(
                    code="DG_CARRIER_REFUSED", severity="error", message=f"{who}{issue.message}",
                    suggestion="Use another carrier for these goods, or reduce the quantity.", item_ids=ids))
            else:
                out.append(PlanWarning(code="DG_CARRIER_NOTE",
                                       severity="warning" if issue.kind == "approval" else "info",
                                       message=f"{who}{issue.message}", item_ids=ids))
    return out

// Real planner responses for tests, generated from the backend with `make fixtures`
// (backend/scripts/export_fixtures.py). Never edit the JSON by hand.
import type { PlanRequest, PlanResult, ReferenceData } from "../api/types.ts";
import referenceJson from "../../__fixtures__/reference.json";
import multidrop from "../../__fixtures__/plan-multidrop.json";
import axleOverload from "../../__fixtures__/plan-axle-overload.json";
import overCapacity from "../../__fixtures__/plan-over-capacity.json";
import bdoubleContainers from "../../__fixtures__/plan-bdouble-containers.json";
import suggest from "../../__fixtures__/plan-suggest.json";
import dgConflict from "../../__fixtures__/plan-dg-conflict.json";

export interface PlanFixture {
  request: PlanRequest;
  result: PlanResult;
}

export const reference = referenceJson as unknown as ReferenceData;

/** Three drops, mixed AU/EURO pallets, a stackable line: fits (drive axle near its limit). */
export const planMultidrop = multidrop as unknown as PlanFixture;
/** Heavy steel at the rear: trailer tri-axle over its limit, doesn't fit. */
export const planAxleOverload = axleOverload as unknown as PlanFixture;
/** 23 pallets on a semi (one over) plus a reefer line on a tautliner. */
export const planOverCapacity = overCapacity as unknown as PlanFixture;
/** 1 x 20' + 1 x 40' HC on a B-double skeletal. */
export const planBdoubleContainers = bdoubleContainers as unknown as PlanFixture;
/** Suggest mode: 7 pallets -> 8 t rigid, with the vehicles tried. */
export const planSuggest = suggest as unknown as PlanFixture;
/** Dangerous goods: paint (3), pool chlorine (5.1), battery acid (8) and general freight on a semi;
 * chlorine is incompatible with both the paint and the acid (2 DG_INCOMPATIBLE errors). */
export const planDgConflict = dgConflict as unknown as PlanFixture;

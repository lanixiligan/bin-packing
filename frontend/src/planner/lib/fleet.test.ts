import { describe, expect, it } from "vitest";
import type { PlanResult, PlanWarning, WarningCode } from "../api/types.ts";
import {
  fleetSample, planAxleOverload, planBdoubleContainers, planDgConflict, planMultidrop, planOverCapacity, planSuggest,
} from "../test/fixtures.ts";
import { canSplit, dgForcesSplit, fleetHeadline, groupUnits, splitBlocker, truckStatus } from "./fleet.ts";

const warning = (code: WarningCode, severity: PlanWarning["severity"] = "error"): PlanWarning =>
  ({ code, severity, message: "", suggestion: "", item_ids: [] });
const failing = (...warnings: PlanWarning[]): PlanResult => ({ ...planMultidrop.result, fits: false, warnings });

describe("canSplit", () => {
  it("is true when the plan fails for a reason more trucks solve", () => {
    expect(canSplit(planOverCapacity.result)).toBe(true); // OVER_CAPACITY
    expect(canSplit(planAxleOverload.result)).toBe(true); // AXLE_OVER_LIMIT
    expect(canSplit(planDgConflict.result)).toBe(true); // DG_INCOMPATIBLE
    expect(canSplit(failing(warning("OVER_PAYLOAD")))).toBe(true);
  });

  it("is false when the plan fits, or fails for a reason more trucks don't solve", () => {
    expect(canSplit(planMultidrop.result)).toBe(false);
    expect(canSplit({ ...planOverCapacity.result, fits: true })).toBe(false);
    expect(canSplit(failing(warning("BODY_INCOMPATIBLE")))).toBe(false);
    expect(canSplit(failing(warning("OVERSIZE_FOOTPRINT"), warning("OVER_HEIGHT_LIMIT"), warning("DG_CARRIER_REFUSED")))).toBe(false);
    // Only errors count: a near-limit warning or a DG note doesn't make it splittable.
    expect(canSplit(failing(warning("AXLE_OVER_LIMIT", "warning"), warning("DG_INCOMPATIBLE", "info")))).toBe(false);
  });
});

describe("splitBlocker", () => {
  it("lets pallets and loose freight on a chosen vehicle split", () => {
    expect(splitBlocker(planOverCapacity.request)).toBeNull();
    expect(splitBlocker(fleetSample.request)).toBeNull();
  });

  it("explains why containers and suggest mode can't", () => {
    expect(splitBlocker(planBdoubleContainers.request)).toMatch(/not containers/);
    expect(splitBlocker(planSuggest.request)).toMatch(/pick a vehicle in step 1/);
  });
});

describe("truckStatus", () => {
  it("reads over, near and fits from the truck's own plan", () => {
    expect(truckStatus(fleetSample.result.trucks[0])).toBe("ok");
    expect(truckStatus(planBdoubleContainers.result)).toBe("near"); // an axle group near its limit
    expect(truckStatus(planAxleOverload.result)).toBe("over");
    expect(truckStatus(planOverCapacity.result)).toBe("over"); // doesn't fit, axles fine
  });
});

describe("fleetHeadline", () => {
  it("says how many trucks and how sure that is", () => {
    expect(fleetHeadline(fleetSample.result)).toBe("2 trucks · Proven fewest");
    expect(fleetHeadline({ ...fleetSample.result, num_trucks: 3, optimal: false })).toBe("3 trucks · Best found · at least 2");
    expect(fleetHeadline({ ...fleetSample.result, num_trucks: 1, lower_bound: 1 })).toBe("1 truck · Proven fewest");
    expect(fleetHeadline({ ...fleetSample.result, num_trucks: 0, trucks: [] })).toBe("No truck can take this freight");
  });
});

describe("groupUnits", () => {
  it("groups unit ids by freight line, named by its label", () => {
    expect(groupUnits(["cem#2", "paint#1", "cem#5", "gone#1"], fleetSample.request.items)).toEqual([
      { itemId: "cem", label: "Cement", unitIds: ["cem#2", "cem#5"] },
      { itemId: "paint", label: "Paint", unitIds: ["paint#1"] },
      { itemId: "gone", label: "gone", unitIds: ["gone#1"] },
    ]);
  });
});

describe("dgForcesSplit", () => {
  it("takes the single-truck plan's word when it is for the same freight", () => {
    const { request, result } = planDgConflict;
    expect(dgForcesSplit(request, result, request)).toBe(true);
    expect(dgForcesSplit(request, { ...result, warnings: [] }, request)).toBe(false);
  });

  it("checks the lines itself when there is no single-truck plan for this freight", () => {
    expect(dgForcesSplit(fleetSample.request, null, null)).toBe(true); // paint (3) with pool chlorine (5.1)
    const noChlorine = { ...fleetSample.request, items: fleetSample.request.items.filter((i) => i.id !== "chlor") };
    expect(dgForcesSplit(noChlorine, planDgConflict.result, planDgConflict.request)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { DG_CLASSES, normalise, validateDg } from "../../dg/rules.ts";
import { dgFromHazard, hazardOf, hazardText, normaliseHazard } from "./dg.ts";

describe("normaliseHazard", () => {
  it("drops subsidiary hazards without a class, the class itself, unknown ones and any past 4", () => {
    expect(normaliseHazard(null, ["8"])).toEqual({ dgClass: null, subsidiary: [] });
    expect(normaliseHazard("food", ["8"])).toEqual({ dgClass: "food", subsidiary: [] });
    expect(normaliseHazard("3", ["8", "3", "6.1", "8", "9"])).toEqual({ dgClass: "3", subsidiary: ["6.1", "8"] });
    expect(normaliseHazard("9", ["8", "6.1", "5.1", "4.1", "3"]).subsidiary).toEqual(["3", "4.1", "5.1", "6.1"]);
  });
});

describe("hazardOf / dgFromHazard", () => {
  it("reads general freight, food, fire-risk and a class", () => {
    expect(hazardOf(null)).toEqual({ dgClass: null, subsidiary: [] });
    expect(hazardOf(normalise({ food: true }))).toEqual({ dgClass: "food", subsidiary: [] });
    expect(hazardOf(normalise({ fire_risk: true }))).toEqual({ dgClass: "fire_risk", subsidiary: [] });
    expect(hazardOf(normalise({ dg_class: "3", subsidiary: ["8", "6.1"] }))).toEqual({ dgClass: "3", subsidiary: ["6.1", "8"] });
  });

  it("writes general freight as null, and food and fire-risk without DG details", () => {
    expect(dgFromHazard({ dgClass: null, subsidiary: [] })).toBeNull();
    const acid = normalise({ dg_class: "8", un_number: "1789", packing_group: "II" });
    expect(dgFromHazard({ dgClass: null, subsidiary: [] }, acid)).toBeNull();
    expect(dgFromHazard({ dgClass: "food", subsidiary: [] }, acid)).toEqual(normalise({ food: true }));
    expect(dgFromHazard({ dgClass: "fire_risk", subsidiary: [] })).toEqual(normalise({ fire_risk: true }));
  });

  it("round-trips a line's DG data, keeping the fields the picker doesn't show", () => {
    const dg = normalise({
      dg_class: "8", subsidiary: ["6.1"], un_number: "1789", packing_group: "II", container: "drum",
      t92: ["acid_strong"], carrier_tags: ["env_hazardous"],
    })!;
    expect(dgFromHazard(hazardOf(dg), dg)).toEqual(dg);
    // A new subsidiary hazard keeps the rest too.
    expect(dgFromHazard({ dgClass: "8", subsidiary: ["5.1", "6.1"] }, dg)).toEqual({ ...dg, subsidiary: ["5.1", "6.1"] });
    // Table 9.2 "not answered" (null) stays not answered.
    const unanswered = normalise({ dg_class: "3", t92: null })!;
    expect(dgFromHazard(hazardOf(unanswered), unanswered)).toEqual(unanswered);
  });

  it("gives a new DG line no Table 9.2 goods, in packages, and Class 1 as 1.4S", () => {
    expect(dgFromHazard({ dgClass: "3", subsidiary: [] })).toEqual(normalise({ dg_class: "3", t92: [], container: "package" }));
    expect(dgFromHazard({ dgClass: "1", subsidiary: [] })?.explosive_code).toBe("1.4S");
    const fireworks = normalise({ dg_class: "1", explosive_code: "1.4G", t92: [] });
    expect(dgFromHazard({ dgClass: "1", subsidiary: [] }, fireworks)?.explosive_code).toBe("1.4G");
    for (const c of DG_CLASSES) expect(validateDg(dgFromHazard({ dgClass: c, subsidiary: [] }))).toEqual([]);
  });

  it("drops details the new class can't have, so the line stays valid", () => {
    const paint = normalise({ dg_class: "3", packing_group: "II", un_number: "1263", t92: [] });
    const gas = dgFromHazard({ dgClass: "2.1", subsidiary: [] }, paint)!;
    expect(gas).toMatchObject({ dg_class: "2.1", packing_group: null, un_number: "1263" });
    expect(validateDg(gas)).toEqual([]);

    const lpg = normalise({ dg_class: "2.1", container: "cylinder", t92: [] });
    expect(dgFromHazard({ dgClass: "3", subsidiary: [] }, lpg)?.container).toBe("package");
    expect(dgFromHazard({ dgClass: "2.2", subsidiary: [] }, lpg)?.container).toBe("cylinder");

    const fireRisk9 = normalise({ dg_class: "9", fire_risk: true, t92: [] });
    expect(dgFromHazard({ dgClass: "6.1", subsidiary: [] }, fireRisk9)?.fire_risk).toBe(true);
    expect(dgFromHazard({ dgClass: "8", subsidiary: [] }, fireRisk9)?.fire_risk).toBe(false);
    expect(dgFromHazard({ dgClass: "1", subsidiary: [] }, paint)?.explosive_code).toBe("1.4S");
  });

  it("describes a hazard in words", () => {
    expect(hazardText(null)).toBe("");
    expect(hazardText("food")).toBe("Food");
    expect(hazardText("3", ["6.1"])).toBe("Class 3 (sub 6.1)");
    expect(hazardText("1")).toBe("Class 1.4S");
  });
});

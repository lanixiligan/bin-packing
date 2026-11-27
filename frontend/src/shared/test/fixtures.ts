// The real GET /api/reference response for tests, generated from the backend with `make fixtures`
// (backend/scripts/export_fixtures.py). Never edit the JSON by hand.
import type { ReferenceData } from "../api/types.ts";
import referenceJson from "./reference.json";

export const reference = referenceJson as unknown as ReferenceData;

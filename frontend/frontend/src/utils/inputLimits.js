import { ANALYZE_BOUNDS, DEFAULT_RECYCLING_SCORE } from "../constants";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clampAnalyzeValue(key, value) {
  const bounds = ANALYZE_BOUNDS[key];
  if (!bounds) {
    return value;
  }
  return clamp(Number(value), bounds.min, bounds.max);
}

export function normalizeAnalyzeInputs(inputs) {
  return {
    electricity: clampAnalyzeValue("electricity", inputs.electricity),
    water: clampAnalyzeValue("water", inputs.water),
    waste: clampAnalyzeValue("waste", inputs.waste),
    recycling: clampAnalyzeValue(
      "recycling",
      inputs.recycling ?? DEFAULT_RECYCLING_SCORE
    ),
  };
}

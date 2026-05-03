import { clampAnalyzeValue } from "./inputLimits";

const SEGREGATION_POINTS = {
  always: 40,
  sometimes: 25,
  rarely: 10,
};

const PICKUP_POINTS = {
  weekly: 25,
  biweekly: 18,
  monthly: 10,
  rarely: 2,
};

const COMPOSTING_POINTS = {
  most: 15,
  some: 8,
  none: 0,
};

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function estimateRecyclingScoreFromAnswers({
  segregationHabit,
  recyclerHandover,
  sortedDryWasteDaysPerWeek,
  compostingLevel,
}) {
  const segregation = SEGREGATION_POINTS[segregationHabit] ?? SEGREGATION_POINTS.sometimes;
  const pickup = PICKUP_POINTS[recyclerHandover] ?? PICKUP_POINTS.monthly;
  const composting = COMPOSTING_POINTS[compostingLevel] ?? COMPOSTING_POINTS.none;

  const dryWasteDays = Math.max(0, Math.min(7, safeNumber(sortedDryWasteDaysPerWeek)));
  const consistency = (dryWasteDays / 7) * 20;

  const score = segregation + pickup + composting + consistency;
  return clampAnalyzeValue("recycling", Math.round(score));
}

import { DEFAULT_HOUSEHOLD_SIZE } from "../constants";

function roundTo(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clampHouseholdSize(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return DEFAULT_HOUSEHOLD_SIZE;
  }
  return Math.max(1, Math.min(15, Math.round(numeric)));
}

export function getAverageValuesForHousehold(people) {
  const householdSize = clampHouseholdSize(people);

  return {
    electricity: roundTo(2.5 + householdSize * 1.5, 1),
    water: roundTo(householdSize * 135, 0),
    waste: roundTo(householdSize * 0.55, 1),
    recycling: 60,
  };
}

import { clampAnalyzeValue } from "./inputLimits";

const BAG_SIZE_KG = {
  small: 0.35,
  medium: 0.65,
  large: 1.1,
};

const COMPOST_REDUCTION_FACTOR = {
  no: 1,
  some: 0.88,
  most: 0.75,
};

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function estimateDailyWasteFromAnswers({
  householdSize,
  cookedMealsPerDay,
  packagedMealsPerWeek,
  garbageBagsPerWeek,
  bagSize,
  compostingLevel,
}) {
  const safeHouseholdSize = Math.max(1, safeNumber(householdSize));
  const safeCookedMeals = Math.max(0, safeNumber(cookedMealsPerDay));
  const safePackagedMeals = Math.max(0, safeNumber(packagedMealsPerWeek));
  const safeBags = Math.max(0, safeNumber(garbageBagsPerWeek));

  const bagWeight = BAG_SIZE_KG[bagSize] ?? BAG_SIZE_KG.medium;
  const compostFactor =
    COMPOST_REDUCTION_FACTOR[compostingLevel] ?? COMPOST_REDUCTION_FACTOR.no;

  // Approximation model:
  // 1) Food scraps from home-cooked meals.
  // 2) Packaging/disposable waste from outside or packaged meals.
  // 3) Additional mixed dry waste from trash bags.
  const foodWastePerDay = safeHouseholdSize * safeCookedMeals * 0.09;
  const packagedWastePerDay = (safePackagedMeals * 0.08) / 7;
  const dryMixedWastePerDay = (safeBags * bagWeight) / 7;

  const estimated = (foodWastePerDay * compostFactor) + packagedWastePerDay + dryMixedWastePerDay;
  return clampAnalyzeValue("waste", Number(estimated.toFixed(2)));
}

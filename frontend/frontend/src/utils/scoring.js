import { AVERAGE_VALUES, DEFAULT_RECYCLING_SCORE } from "../constants";

function normalizeRecycling(recyclingValue) {
  if (recyclingValue <= 1) {
    return recyclingValue;
  }
  return recyclingValue / 100;
}

export function roundTo(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateHeuristicScore(inputs) {
  return roundTo(calculateRuleBasedScore(inputs), 1);
}

export function calculateRuleBasedScore(inputs) {
  const electricityPenalty = Math.min(inputs.electricity / 15, 1) * 35;
  const waterPenalty = Math.min(inputs.water / 250, 1) * 25;
  const wastePenalty = Math.min(inputs.waste / 3, 1) * 25;
  const recyclingBonus =
    Math.min(normalizeRecycling(inputs.recycling ?? DEFAULT_RECYCLING_SCORE), 1) *
    15;

  const score =
    100 - electricityPenalty - waterPenalty - wastePenalty + recyclingBonus;
  return Math.max(0, Math.min(100, score));
}

export function getStatusMeta(score) {
  if (score >= 70) {
    return { label: "Good", tone: "good" };
  }
  if (score >= 40) {
    return { label: "Moderate", tone: "moderate" };
  }
  return { label: "Poor", tone: "poor" };
}

function getDeviation(value, average) {
  if (!average) {
    return 0;
  }
  return Math.abs((value - average) / average);
}

export function getContextAwareStatus(score, inputs, averageValues = AVERAGE_VALUES) {
  const base = getStatusMeta(score);

  if (!inputs || !averageValues) {
    return base;
  }

  const deviations = [
    getDeviation(inputs.electricity, averageValues.electricity),
    getDeviation(inputs.water, averageValues.water),
    getDeviation(inputs.waste, averageValues.waste),
  ];
  const maxDeviation = Math.max(...deviations);

  // If usage is close to household average values, avoid showing a harsh "Poor"
  // label caused by model score calibration mismatch.
  if (base.tone === "poor" && maxDeviation <= 0.18) {
    return { label: "Moderate", tone: "moderate" };
  }

  return base;
}

export function calculatePercentDifference(value, average) {
  if (!average) {
    return 0;
  }
  return ((value - average) / average) * 100;
}

export function getMetricTone(metricName, value, averageValues = AVERAGE_VALUES) {
  const average = averageValues[metricName];
  if (!average) {
    return "moderate";
  }

  if (value <= average * 1.05) {
    return "good";
  }
  if (value <= average * 1.35) {
    return "moderate";
  }
  return "poor";
}

export function buildInsightSuggestions(inputs, averageValues = AVERAGE_VALUES) {
  const suggestions = [];

  if (inputs.electricity > averageValues.electricity) {
    suggestions.push("Reduce AC usage by 1 to 2 hours and switch to inverter mode.");
  }
  if (inputs.water > averageValues.water) {
    suggestions.push("Use low-flow taps and fix leakages to cut daily water loss.");
  }
  if (inputs.waste > averageValues.waste) {
    suggestions.push("Separate dry and wet waste, and compost kitchen scraps.");
  }

  if (suggestions.length === 0) {
    suggestions.push("Current household usage is in a healthy range. Keep it consistent.");
  }

  return suggestions;
}

export function formatDifferenceText(diffValue) {
  const abs = Math.abs(roundTo(diffValue, 1));
  if (abs === 0) {
    return "at average";
  }
  return diffValue > 0 ? `${abs}% above average` : `${abs}% below average`;
}

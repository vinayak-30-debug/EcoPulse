import { calculateRuleBasedScore } from "./scoring";

const SCORE_PROXY_CONFIG = {
  electricity: { high: 15, weight: 35 },
  water: { high: 250, weight: 25 },
  waste: { high: 3, weight: 25 },
  recycling: { high: 100, weight: 15 },
};

const FALLBACK_DELTA_SCALE = 0.25;

function roundValue(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateContinuousProxyScore(inputs) {
  const electricityPenalty =
    (inputs.electricity / SCORE_PROXY_CONFIG.electricity.high) *
    SCORE_PROXY_CONFIG.electricity.weight;
  const waterPenalty =
    (inputs.water / SCORE_PROXY_CONFIG.water.high) * SCORE_PROXY_CONFIG.water.weight;
  const wastePenalty =
    (inputs.waste / SCORE_PROXY_CONFIG.waste.high) * SCORE_PROXY_CONFIG.waste.weight;
  const recyclingBonus =
    Math.min(inputs.recycling / SCORE_PROXY_CONFIG.recycling.high, 1) *
    SCORE_PROXY_CONFIG.recycling.weight;

  // Keep the proxy continuous (no saturation for penalties) so high-usage what-if
  // scenarios can still show improvement even when rule-based penalties are capped.
  return 100 - electricityPenalty - waterPenalty - wastePenalty + recyclingBonus;
}

export function buildWhatIfScenarios(payload) {
  const current = {
    electricity: Number(payload.electricity),
    water: Number(payload.water),
    waste: Number(payload.waste),
    recycling: Number(payload.recycling),
  };

  return [
    {
      id: "reduce-electricity",
      label: "Reduce electricity by 20%",
      payload: {
        ...current,
        electricity: roundValue(clamp(current.electricity * 0.8, 0, 50)),
      },
    },
    {
      id: "reduce-water",
      label: "Reduce water by 15%",
      payload: {
        ...current,
        water: roundValue(clamp(current.water * 0.85, 0, 1000)),
      },
    },
    {
      id: "reduce-waste",
      label: "Reduce waste by 20%",
      payload: {
        ...current,
        waste: roundValue(clamp(current.waste * 0.8, 0, 20)),
      },
    },
    {
      id: "improve-recycling",
      label: "Improve recycling by 20 points",
      payload: {
        ...current,
        recycling: roundValue(clamp(current.recycling + 20, 0, 100)),
      },
    },
  ];
}

export function simulateWhatIfResults(currentInputs, currentModelScore) {
  const scenarios = buildWhatIfScenarios(currentInputs);
  const baseRuleScore = calculateRuleBasedScore(currentInputs);
  const baseProxyScore = calculateContinuousProxyScore(currentInputs);

  return scenarios
    .map((scenario) => {
      const scenarioRuleScore = calculateRuleBasedScore(scenario.payload);
      const ruleDelta = scenarioRuleScore - baseRuleScore;
      const scenarioProxyScore = calculateContinuousProxyScore(scenario.payload);
      const proxyDelta = scenarioProxyScore - baseProxyScore;

      let effectiveDelta = ruleDelta;
      if (Math.abs(ruleDelta) < 0.15 && proxyDelta > 0) {
        effectiveDelta = proxyDelta * FALLBACK_DELTA_SCALE;
      }
      if (effectiveDelta > 0 && effectiveDelta < 0.1) {
        effectiveDelta = 0.1;
      }

      const adjustedScore = clamp(currentModelScore + effectiveDelta, 0, 100);
      const delta = adjustedScore - currentModelScore;

      return {
        ...scenario,
        score: roundValue(adjustedScore, 2),
        delta: roundValue(delta, 2),
      };
    })
    .sort((a, b) => b.score - a.score);
}

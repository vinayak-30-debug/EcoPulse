import { DEFAULT_RECYCLING_SCORE } from "../constants";
import {
  buildInsightSuggestions,
  calculateHeuristicScore,
  calculatePercentDifference,
  formatDifferenceText,
  roundTo,
} from "../utils/scoring";

const metricRows = [
  { key: "electricity", label: "Electricity", unit: "kWh/day" },
  { key: "water", label: "Water", unit: "L/day" },
  { key: "waste", label: "Waste", unit: "kg/day" },
];

function InsightsPage({ inputs, householdSize, averageValues, prediction, score, status }) {
  const baselineScore = calculateHeuristicScore({
    ...averageValues,
    recycling: DEFAULT_RECYCLING_SCORE,
  });

  const scoreDiff = roundTo(score - baselineScore, 1);

  const suggestions = prediction?.suggestions?.length
    ? prediction.suggestions
    : buildInsightSuggestions(inputs, averageValues);

  return (
    <section className="insights-stack">
      <article className="card">
        <h2>Comparison with Average Household ({householdSize} people)</h2>
        <div className="comparison-table">
          {metricRows.map((metric) => {
            const value = inputs[metric.key];
            const average = averageValues[metric.key];
            const diff = calculatePercentDifference(value, average);

            return (
              <div className="comparison-row" key={metric.key}>
                <span>{metric.label}</span>
                <span>
                  {roundTo(value, 1)} {metric.unit}
                </span>
                <span>{formatDifferenceText(diff)}</span>
              </div>
            );
          })}
        </div>
      </article>

      <article className="card">
        <h2>Performance Snapshot</h2>
        <div className="snapshot-grid">
          <div className={`snapshot ${status.tone}`}>
            <p>Current score</p>
            <strong>{roundTo(score, 1)} / 100</strong>
          </div>
          <div className={`snapshot ${scoreDiff >= 0 ? "good" : "poor"}`}>
            <p>Difference vs average score</p>
            <strong>{scoreDiff >= 0 ? "+" : ""}{scoreDiff} points</strong>
          </div>
          <div className="snapshot moderate">
            <p>Status</p>
            <strong>{status.label}</strong>
          </div>
        </div>
      </article>

      <article className="card">
        <h2>Suggestions to Improve Sustainability</h2>
        <ul className="simple-list">
          {suggestions.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      </article>
    </section>
  );
}

export default InsightsPage;

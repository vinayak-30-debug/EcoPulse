import {
  calculatePercentDifference,
  formatDifferenceText,
  getMetricTone,
  roundTo,
} from "../utils/scoring";

const metricMeta = [
  { key: "electricity", label: "Electricity", unit: "kWh/day" },
  { key: "water", label: "Water", unit: "L/day" },
  { key: "waste", label: "Waste", unit: "kg/day" },
];

function DashboardPage({
  score,
  status,
  inputs,
  averageValues,
  hasPrediction,
  onNavigate,
}) {
  return (
    <section className="page-grid">
      <article className="card score-hero">
        <p className="card-kicker">Household Sustainability Score</p>
        <div className={`score-badge ${status.tone}`}>
          <span className="score-value">{roundTo(score, 1)}</span>
          <span className="score-scale">/ 100</span>
        </div>
        <p className={`status-pill ${status.tone}`}>{status.label}</p>
        <p className="muted">
          {hasPrediction
            ? "Based on your latest ML analysis."
            : "Preview score based on your current input values."}
        </p>
        <button type="button" className="primary-btn" onClick={() => onNavigate("analyze")}>
          Open Analyze
        </button>
      </article>

      <section className="metric-grid">
        {metricMeta.map((metric) => {
          const value = inputs[metric.key];
          const tone = getMetricTone(metric.key, value, averageValues);
          const diff = calculatePercentDifference(value, averageValues[metric.key]);

          return (
            <article key={metric.key} className={`card metric-card ${tone}`}>
              <p className="card-kicker">{metric.label}</p>
              <p className="metric-value">
                {roundTo(value, 1)} <span>{metric.unit}</span>
              </p>
              <p className="muted">{formatDifferenceText(diff)}</p>
            </article>
          );
        })}
      </section>
    </section>
  );
}

export default DashboardPage;

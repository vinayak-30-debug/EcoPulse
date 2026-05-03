import { useMemo, useState } from "react";

import {
  DEFAULT_ANALYZE_INPUTS,
  DEFAULT_HOUSEHOLD_SIZE,
  DEFAULT_RECYCLING_SCORE,
} from "../constants";
import { predictSustainability } from "../services/api";
import { clampHouseholdSize, getAverageValuesForHousehold } from "../utils/householdAverages";
import { normalizeAnalyzeInputs } from "../utils/inputLimits";
import {
  buildInsightSuggestions,
  getContextAwareStatus,
  roundTo,
} from "../utils/scoring";
import { simulateWhatIfResults } from "../utils/whatIf";

const MONTHLY_INPUT_CONFIG = {
  electricity: {
    label: "Electricity usage",
    unit: "kWh/month",
    min: 0,
    max: 1550,
    step: 1,
  },
  water: {
    label: "Water consumption",
    unit: "liters/month",
    min: 0,
    max: 31000,
    step: 10,
  },
  waste: {
    label: "Waste generated",
    unit: "kg/month",
    min: 0,
    max: 620,
    step: 0.1,
  },
  recycling: {
    label: "Recycling score",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
  },
};

const MONTHLY_METRIC_ROWS = [
  { key: "electricity", label: "Electricity", unit: "kWh/month", decimals: 1 },
  { key: "water", label: "Water", unit: "L/month", decimals: 0 },
  { key: "waste", label: "Waste", unit: "kg/month", decimals: 1 },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCurrentMonthValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function getDaysInMonth(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(monthValue || "")) {
    return 30;
  }

  const [year, month] = monthValue.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function formatMonthLabel(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(monthValue || "")) {
    return monthValue;
  }

  const [year, month] = monthValue.split("-").map(Number);
  const monthDate = new Date(year, month - 1, 1);
  return monthDate.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function getScenarioGraphLabel(label) {
  if (/electricity/i.test(label)) {
    return "Electricity";
  }
  if (/water/i.test(label)) {
    return "Water";
  }
  if (/waste/i.test(label)) {
    return "Waste";
  }
  if (/recycling/i.test(label)) {
    return "Recycling";
  }
  return label;
}

function getDefaultMonthlyInputs(initialInputs, monthValue) {
  const daysInMonth = getDaysInMonth(monthValue);

  return {
    electricity: roundTo(
      Number(initialInputs?.electricity ?? DEFAULT_ANALYZE_INPUTS.electricity) * daysInMonth,
      1
    ),
    water: roundTo(Number(initialInputs?.water ?? DEFAULT_ANALYZE_INPUTS.water) * daysInMonth, 0),
    waste: roundTo(Number(initialInputs?.waste ?? DEFAULT_ANALYZE_INPUTS.waste) * daysInMonth, 1),
    recycling: roundTo(
      Number(initialInputs?.recycling ?? DEFAULT_RECYCLING_SCORE),
      0
    ),
  };
}

function formatDifference(actual, average, decimals) {
  const diff = roundTo(actual - average, decimals);
  if (diff === 0) {
    return "at average";
  }
  return diff > 0 ? `${diff} above avg` : `${Math.abs(diff)} below avg`;
}

function MonthlyReportPage({
  initialInputs = DEFAULT_ANALYZE_INPUTS,
  initialHouseholdSize = DEFAULT_HOUSEHOLD_SIZE,
}) {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthValue);
  const [householdSize, setHouseholdSize] = useState(() =>
    clampHouseholdSize(initialHouseholdSize)
  );
  const [monthlyInputs, setMonthlyInputs] = useState(() =>
    getDefaultMonthlyInputs(initialInputs, getCurrentMonthValue())
  );
  const [reports, setReports] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const sortedReports = useMemo(
    () => [...reports].sort((a, b) => a.month.localeCompare(b.month)),
    [reports]
  );

  const selectedReport = useMemo(() => {
    if (!sortedReports.length) {
      return null;
    }
    return (
      sortedReports.find((report) => report.id === selectedReportId) ||
      sortedReports[sortedReports.length - 1]
    );
  }, [sortedReports, selectedReportId]);

  const scoreTrendRows = useMemo(
    () =>
      sortedReports.map((report) => ({
        id: report.id,
        month: report.month,
        label: report.monthLabel,
        score: report.score,
      })),
    [sortedReports]
  );

  const scoreTrendInsight = useMemo(() => {
    if (scoreTrendRows.length < 2) {
      return "Add at least 2 monthly reports to view trend changes.";
    }

    const first = scoreTrendRows[0];
    const latest = scoreTrendRows[scoreTrendRows.length - 1];
    const delta = roundTo(latest.score - first.score, 1);

    if (delta > 0) {
      return `Trend is improving by ${delta} points from ${first.label} to ${latest.label}.`;
    }
    if (delta < 0) {
      return `Trend declined by ${Math.abs(delta)} points from ${first.label} to ${latest.label}.`;
    }
    return `Trend is stable from ${first.label} to ${latest.label}.`;
  }, [scoreTrendRows]);

  const selectedWhatIfGraphRows = useMemo(() => {
    if (!selectedReport) {
      return [];
    }

    return [
      {
        id: "current",
        label: "Current",
        score: selectedReport.score,
        delta: 0,
      },
      ...(selectedReport.whatIfResults || []).map((scenario) => ({
        id: scenario.id,
        label: getScenarioGraphLabel(scenario.label),
        score: scenario.score,
        delta: scenario.delta,
      })),
    ];
  }, [selectedReport]);

  const bestScenario = useMemo(() => {
    if (!selectedReport?.whatIfResults?.length) {
      return null;
    }

    return [...selectedReport.whatIfResults].sort((a, b) => b.score - a.score)[0];
  }, [selectedReport]);

  const selectedMonthComparisonRows = useMemo(() => {
    if (!selectedReport) {
      return [];
    }

    return MONTHLY_METRIC_ROWS.map((metric) => {
      const actual = Number(selectedReport.monthlyInputs[metric.key] || 0);
      const average = Number(selectedReport.averageMonthly[metric.key] || 0);
      const maxValue = Math.max(actual, average, 1);

      return {
        ...metric,
        actual,
        average,
        actualWidth: `${Math.max(2, (actual / maxValue) * 100)}%`,
        averageWidth: `${Math.max(2, (average / maxValue) * 100)}%`,
        differenceText: formatDifference(actual, average, metric.decimals),
      };
    });
  }, [selectedReport]);

  const handleSelectMonthReport = (report) => {
    if (!report) {
      return;
    }

    setSelectedReportId(report.id);
    setSelectedMonth(report.month);
    setHouseholdSize(report.householdSize);
    setMonthlyInputs(report.monthlyInputs);
    setNotice(`Loaded report for ${report.monthLabel}.`);
    setError("");
  };

  const handleMonthChange = (nextMonth) => {
    if (!nextMonth) {
      return;
    }

    const currentDays = getDaysInMonth(selectedMonth);
    const nextDays = getDaysInMonth(nextMonth);

    setSelectedMonth(nextMonth);
    setMonthlyInputs((prev) => ({
      ...prev,
      electricity: roundTo((prev.electricity / currentDays) * nextDays, 1),
      water: roundTo((prev.water / currentDays) * nextDays, 0),
      waste: roundTo((prev.waste / currentDays) * nextDays, 1),
    }));
    setNotice("");
    setError("");
  };

  const handleMonthlyInputChange = (key, value) => {
    const config = MONTHLY_INPUT_CONFIG[key];
    if (!config) {
      return;
    }

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
      return;
    }

    setMonthlyInputs((prev) => ({
      ...prev,
      [key]: clamp(numericValue, config.min, config.max),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    const daysInMonth = getDaysInMonth(selectedMonth);
    const dailyInputs = normalizeAnalyzeInputs({
      electricity: Number(monthlyInputs.electricity) / daysInMonth,
      water: Number(monthlyInputs.water) / daysInMonth,
      waste: Number(monthlyInputs.waste) / daysInMonth,
      recycling: Number(monthlyInputs.recycling),
    });

    const payload = {
      ...dailyInputs,
      household_size: householdSize,
    };

    try {
      const result = await predictSustainability(payload);
      const rawScore = Number(result.score);
      const score = Number.isFinite(rawScore) ? rawScore : 0;
      const averageDaily = getAverageValuesForHousehold(householdSize);
      const averageMonthly = {
        electricity: roundTo(averageDaily.electricity * daysInMonth, 1),
        water: roundTo(averageDaily.water * daysInMonth, 0),
        waste: roundTo(averageDaily.waste * daysInMonth, 1),
        recycling: roundTo(averageDaily.recycling, 0),
      };

      const reportId = `month-${selectedMonth}`;
      const monthLabel = formatMonthLabel(selectedMonth);
      const status = getContextAwareStatus(score, dailyInputs, averageDaily);
      const suggestions = result?.suggestions?.length
        ? result.suggestions
        : buildInsightSuggestions(dailyInputs, averageDaily);

      const nextReport = {
        id: reportId,
        month: selectedMonth,
        monthLabel,
        daysInMonth,
        householdSize,
        monthlyInputs: {
          electricity: roundTo(Number(monthlyInputs.electricity), 1),
          water: roundTo(Number(monthlyInputs.water), 0),
          waste: roundTo(Number(monthlyInputs.waste), 1),
          recycling: roundTo(Number(monthlyInputs.recycling), 0),
        },
        dailyInputs,
        averageMonthly,
        score,
        status,
        sustainabilityLevel: result?.sustainability_level || "",
        suggestions,
        whatIfResults: simulateWhatIfResults(dailyInputs, score),
        updatedAt: new Date().toISOString(),
      };

      setReports((prev) =>
        [...prev.filter((report) => report.id !== reportId), nextReport].sort((a, b) =>
          a.month.localeCompare(b.month)
        )
      );
      setSelectedReportId(reportId);
      setNotice(`Monthly report generated for ${monthLabel}.`);
    } catch (err) {
      setError(err.message || "Unable to generate monthly report right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="monthly-stack">
      <article className="card">
        <h2>Monthly Sustainability Report</h2>
        <p className="muted">
          Enter monthly values for electricity, water, waste, and recycling. We use
          the same model inputs by converting totals to daily averages before scoring.
        </p>

        {notice && <p className="notice">{notice}</p>}

        <form className="slider-form" onSubmit={handleSubmit}>
          <div className="monthly-form-grid">
            <label className="input-field">
              <span>Month</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => handleMonthChange(event.target.value)}
              />
            </label>

            <label className="input-field">
              <span>Household size (people)</span>
              <input
                type="number"
                min="1"
                max="15"
                value={householdSize}
                onChange={(event) =>
                  setHouseholdSize(clampHouseholdSize(event.target.value))
                }
              />
            </label>
          </div>

          {Object.entries(MONTHLY_INPUT_CONFIG).map(([key, config]) => {
            const value = Number(monthlyInputs[key] || 0);
            const daysInMonth = getDaysInMonth(selectedMonth);
            const dailyEquivalent =
              key === "recycling" ? value : roundTo(value / daysInMonth, 1);
            const dailyUnit = key === "water" ? "L/day" : key === "waste" ? "kg/day" : "kWh/day";

            return (
              <div className="slider-field" key={key}>
                <div className="slider-row">
                  <span>{config.label}</span>
                  <strong>
                    {roundTo(value, key === "water" || key === "recycling" ? 0 : 1)}{" "}
                    {config.unit}
                  </strong>
                </div>
                <input
                  type="range"
                  min={config.min}
                  max={config.max}
                  step={config.step}
                  value={value}
                  onChange={(event) =>
                    handleMonthlyInputChange(key, Number(event.target.value))
                  }
                />
                {key === "recycling" ? (
                  <small>Daily equivalent stays the same: {roundTo(dailyEquivalent, 0)}%</small>
                ) : (
                  <small>
                    Daily equivalent for model input: {dailyEquivalent} {dailyUnit}
                  </small>
                )}
              </div>
            );
          })}

          <button type="submit" className="primary-btn full-width" disabled={loading}>
            {loading ? "Generating Monthly Report..." : "Generate Monthly Report"}
          </button>
        </form>

        {error && <p className="error-text">{error}</p>}

        {sortedReports.length > 0 && (
          <div className="monthly-history">
            {sortedReports.map((report) => (
              <button
                type="button"
                key={report.id}
                className={`monthly-history-btn ${
                  selectedReport?.id === report.id ? "active" : ""
                }`}
                onClick={() => handleSelectMonthReport(report)}
              >
                {report.monthLabel}
              </button>
            ))}
          </div>
        )}
      </article>

      <article className="card">
        <h2>Monthly Result</h2>
        {!selectedReport && (
          <p className="muted">
            Generate a monthly report to view sustainability score, suggestions, and
            what-if simulation.
          </p>
        )}

        {selectedReport && (
          <div className="result-stack">
            <div className={`result-score ${selectedReport.status.tone}`}>
              <p>Score ({selectedReport.monthLabel})</p>
              <strong>{roundTo(selectedReport.score, 1)} / 100</strong>
              <span>{selectedReport.status.label}</span>
            </div>

            <p className="muted">
              Based on {selectedReport.daysInMonth} days and household size of{" "}
              {selectedReport.householdSize}.
            </p>

            {selectedReport.sustainabilityLevel && (
              <p className="muted">
                Model label: {selectedReport.sustainabilityLevel}
              </p>
            )}

            <p className="muted">
              Updated:{" "}
              {new Date(selectedReport.updatedAt).toLocaleDateString()}{" "}
              {new Date(selectedReport.updatedAt).toLocaleTimeString()}
            </p>

            <div>
              <h3>Suggestions</h3>
              <ul className="simple-list">
                {(selectedReport.suggestions || []).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3>What-if Simulation</h3>
              <p className="whatif-current">
                Current score: <strong>{roundTo(selectedReport.score, 1)}</strong>
              </p>

              {selectedReport.whatIfResults?.length > 0 ? (
                <>
                  <ul className="simple-list whatif-list">
                    {selectedReport.whatIfResults.map((scenario) => (
                      <li key={scenario.id}>
                        <span>{scenario.label}</span>
                        <span>
                          {" -> "}
                          <strong>{roundTo(scenario.score, 1)}</strong>
                          <em
                            className={
                              scenario.delta >= 0 ? "delta-positive" : "delta-negative"
                            }
                          >
                            {" "}
                            ({scenario.delta >= 0 ? "+" : ""}
                            {roundTo(scenario.delta, 1)})
                          </em>
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="whatif-chart">
                    <p className="card-kicker">What-if Graph Analysis</p>
                    <div className="whatif-bar-chart">
                      {selectedWhatIfGraphRows.map((item, index) => (
                        <div className="whatif-bar-item" key={item.id}>
                          <div className="whatif-bar-meta">
                            <span className="whatif-bar-score">{roundTo(item.score, 1)}</span>
                            {item.id !== "current" && (
                              <em
                                className={
                                  item.delta >= 0 ? "delta-positive" : "delta-negative"
                                }
                              >
                                {" "}
                                ({item.delta >= 0 ? "+" : ""}
                                {roundTo(item.delta, 1)})
                              </em>
                            )}
                          </div>
                          <div className="whatif-bar-track">
                            <div
                              className={`whatif-bar ${
                                item.id === "current" ? "current" : ""
                              }`}
                              style={{
                                "--bar-height": `${Math.max(10, Number(item.score))}%`,
                                "--bar-delay": `${index * 90}ms`,
                              }}
                            />
                          </div>
                          <span
                            className={`whatif-bar-label ${
                              item.id === "current" ? "current" : ""
                            }`}
                          >
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    {bestScenario && (
                      <p className="whatif-chart-insight muted">
                        Best outcome: <strong>{bestScenario.label}</strong> with a{" "}
                        {bestScenario.delta >= 0 ? "+" : ""}
                        {roundTo(bestScenario.delta, 1)} point change.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="muted">What-if simulation is unavailable right now.</p>
              )}
            </div>
          </div>
        )}
      </article>

      <article className="card">
        <h2>Graph Analysis for Monthly Report</h2>
        {scoreTrendRows.length === 0 && (
          <p className="muted">
            Add monthly reports to unlock trend charts and month-on-month analysis.
          </p>
        )}

        {scoreTrendRows.length > 0 && (
          <>
            <div className="monthly-score-chart">
              {scoreTrendRows.map((item, index) => {
                const isActive = selectedReport?.id === item.id;
                return (
                  <div className="monthly-score-item" key={item.id}>
                    <p className={`monthly-score-value ${isActive ? "active" : ""}`}>
                      {roundTo(item.score, 1)}
                    </p>
                    <button
                      type="button"
                      className={`monthly-score-track ${isActive ? "active" : ""}`}
                      onClick={() =>
                        handleSelectMonthReport(
                          sortedReports.find((report) => report.id === item.id)
                        )
                      }
                    >
                      <span
                        className={`monthly-score-fill ${isActive ? "active" : ""}`}
                        style={{
                          "--bar-height": `${Math.max(10, Number(item.score))}%`,
                          "--bar-delay": `${index * 80}ms`,
                        }}
                      />
                    </button>
                    <p className={`monthly-score-label ${isActive ? "active" : ""}`}>
                      {item.label}
                    </p>
                  </div>
                );
              })}
            </div>

            <p className="whatif-chart-insight muted">{scoreTrendInsight}</p>

            {selectedMonthComparisonRows.length > 0 && (
              <div className="monthly-comparison">
                <p className="card-kicker">
                  {selectedReport.monthLabel}: usage vs average ({selectedReport.householdSize} people)
                </p>
                <div className="monthly-legend">
                  <span>Actual</span>
                  <span>Average</span>
                </div>
                <div className="monthly-comparison-grid">
                  {selectedMonthComparisonRows.map((row) => (
                    <div key={row.key} className="monthly-comparison-row">
                      <div className="monthly-comparison-header">
                        <span>{row.label}</span>
                        <small>{row.differenceText}</small>
                      </div>
                      <div className="monthly-comparison-bars">
                        <span
                          className="monthly-comparison-bar actual"
                          style={{ width: row.actualWidth }}
                        />
                        <span
                          className="monthly-comparison-bar average"
                          style={{ width: row.averageWidth }}
                        />
                      </div>
                      <div className="monthly-comparison-values">
                        <span>
                          {roundTo(row.actual, row.decimals)} {row.unit}
                        </span>
                        <span>
                          {roundTo(row.average, row.decimals)} {row.unit}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </article>
    </section>
  );
}

export default MonthlyReportPage;

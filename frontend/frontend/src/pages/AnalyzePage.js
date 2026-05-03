import { useState } from "react";

import { ANALYZE_SLIDER_CONFIG } from "../constants";
import { getContextAwareStatus, roundTo } from "../utils/scoring";
import { clampHouseholdSize } from "../utils/householdAverages";
import { estimateDailyWasteFromAnswers } from "../utils/wasteEstimate";
import { estimateRecyclingScoreFromAnswers } from "../utils/recyclingEstimate";

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

function AnalyzePage({
  inputs,
  householdSize,
  averageValues,
  prediction,
  whatIfResults,
  whatIfLoading,
  whatIfError,
  billUploadLoading,
  loading,
  error,
  notice,
  lastUpdated,
  onInputChange,
  onHouseholdSizeChange,
  onBillUpload,
  onSubmit,
}) {
  const [wasteAnswers, setWasteAnswers] = useState({
    cookedMealsPerDay: 2,
    packagedMealsPerWeek: 4,
    garbageBagsPerWeek: 5,
    bagSize: "medium",
    compostingLevel: "some",
  });
  const [wasteEstimateNotice, setWasteEstimateNotice] = useState("");
  const [recyclingAnswers, setRecyclingAnswers] = useState({
    segregationHabit: "sometimes",
    recyclerHandover: "monthly",
    sortedDryWasteDaysPerWeek: 4,
    compostingLevel: "some",
  });
  const [recyclingEstimateNotice, setRecyclingEstimateNotice] = useState("");

  const score = prediction?.score;
  const status =
    score !== undefined
      ? getContextAwareStatus(score, inputs, averageValues)
      : null;
  const graphRows =
    !whatIfLoading && whatIfResults?.length > 0 && score !== undefined
      ? [
          {
            id: "current",
            label: "Current",
            score,
            delta: 0,
          },
          ...whatIfResults.map((scenario) => ({
            id: scenario.id,
            label: getScenarioGraphLabel(scenario.label),
            score: scenario.score,
            delta: scenario.delta,
          })),
        ]
      : [];
  const bestScenario =
    !whatIfLoading && whatIfResults?.length > 0
      ? [...whatIfResults].sort((a, b) => b.score - a.score)[0]
      : null;

  const handleWasteAnswerChange = (field, value) => {
    setWasteAnswers((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleWasteEstimateApply = () => {
    const estimatedWaste = estimateDailyWasteFromAnswers({
      householdSize,
      ...wasteAnswers,
    });

    onInputChange("waste", estimatedWaste);
    setWasteEstimateNotice(
      `Estimated and applied: ${roundTo(estimatedWaste, 1)} kg/day. You can still fine-tune using the slider.`
    );
  };

  const handleRecyclingAnswerChange = (field, value) => {
    setRecyclingAnswers((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleRecyclingEstimateApply = () => {
    const estimatedRecycling = estimateRecyclingScoreFromAnswers(recyclingAnswers);
    onInputChange("recycling", estimatedRecycling);
    setRecyclingEstimateNotice(
      `Estimated and applied: ${estimatedRecycling}% recycling score. You can still fine-tune using the slider.`
    );
  };

  return (
    <section className="page-grid">
      <article className="card">
        <h2>Analyze Household Inputs</h2>
        <p className="muted">
          Set your usage values and run the ML model to get sustainability score
          and practical suggestions.
        </p>

        {notice && <p className="notice">{notice}</p>}

        <form
          className="slider-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="input-field analyze-size-field">
            <span>Household size (people)</span>
            <input
              type="number"
              min="1"
              max="15"
              value={householdSize}
              onChange={(event) =>
                onHouseholdSizeChange(clampHouseholdSize(event.target.value))
              }
            />
          </label>

          {Object.entries(ANALYZE_SLIDER_CONFIG).map(([key, config]) => (
            <div className="slider-field" key={key}>
              <div className="slider-row">
                <span>{config.label}</span>
                <strong>
                  {roundTo(inputs[key], 1)} {config.unit}
                </strong>
              </div>
              <input
                type="range"
                min={config.min}
                max={config.max}
                step={config.step}
                value={inputs[key]}
                onChange={(event) => onInputChange(key, Number(event.target.value))}
              />
              {key === "recycling" ? (
                <small>Recommended baseline: {roundTo(averageValues.recycling, 0)}%</small>
              ) : (
                <small>
                  Average for {householdSize} people: {roundTo(averageValues[key], 1)}{" "}
                  {config.averageUnit || config.unit}
                </small>
              )}

              {key === "waste" && (
                <div className="waste-questionnaire">
                  <h4>Not sure about daily waste? Use this quick estimate.</h4>

                  <div className="waste-question-grid">
                    <label className="input-field">
                      Meals cooked at home per day
                      <select
                        value={wasteAnswers.cookedMealsPerDay}
                        onChange={(event) =>
                          handleWasteAnswerChange(
                            "cookedMealsPerDay",
                            Number(event.target.value)
                          )
                        }
                      >
                        <option value={0}>0</option>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={4}>4+</option>
                      </select>
                    </label>

                    <label className="input-field">
                      Packaged or takeaway meals per week
                      <input
                        type="number"
                        min="0"
                        max="35"
                        value={wasteAnswers.packagedMealsPerWeek}
                        onChange={(event) =>
                          handleWasteAnswerChange(
                            "packagedMealsPerWeek",
                            Number(event.target.value)
                          )
                        }
                      />
                    </label>

                    <label className="input-field">
                      Garbage bags filled per week
                      <input
                        type="number"
                        min="0"
                        max="35"
                        value={wasteAnswers.garbageBagsPerWeek}
                        onChange={(event) =>
                          handleWasteAnswerChange(
                            "garbageBagsPerWeek",
                            Number(event.target.value)
                          )
                        }
                      />
                    </label>

                    <label className="input-field">
                      Common garbage bag size
                      <select
                        value={wasteAnswers.bagSize}
                        onChange={(event) =>
                          handleWasteAnswerChange("bagSize", event.target.value)
                        }
                      >
                        <option value="small">Small (8-10 L)</option>
                        <option value="medium">Medium (18-22 L)</option>
                        <option value="large">Large (30+ L)</option>
                      </select>
                    </label>

                    <label className="input-field">
                      Food waste composting
                      <select
                        value={wasteAnswers.compostingLevel}
                        onChange={(event) =>
                          handleWasteAnswerChange("compostingLevel", event.target.value)
                        }
                      >
                        <option value="no">No composting</option>
                        <option value="some">Some composting</option>
                        <option value="most">Most food waste composted</option>
                      </select>
                    </label>
                  </div>

                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={handleWasteEstimateApply}
                  >
                    Estimate waste for me
                  </button>

                  {wasteEstimateNotice && (
                    <p className="muted waste-estimate-note">{wasteEstimateNotice}</p>
                  )}
                </div>
              )}

              {key === "recycling" && (
                <div className="waste-questionnaire">
                  <h4>Not sure about recycling score? Use this quick estimate.</h4>

                  <div className="waste-question-grid">
                    <label className="input-field">
                      Do you segregate wet and dry waste?
                      <select
                        value={recyclingAnswers.segregationHabit}
                        onChange={(event) =>
                          handleRecyclingAnswerChange(
                            "segregationHabit",
                            event.target.value
                          )
                        }
                      >
                        <option value="always">Always</option>
                        <option value="sometimes">Sometimes</option>
                        <option value="rarely">Rarely / never</option>
                      </select>
                    </label>

                    <label className="input-field">
                      How often do recyclables reach recycler/scrap dealer?
                      <select
                        value={recyclingAnswers.recyclerHandover}
                        onChange={(event) =>
                          handleRecyclingAnswerChange(
                            "recyclerHandover",
                            event.target.value
                          )
                        }
                      >
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Every 2 weeks</option>
                        <option value="monthly">Monthly</option>
                        <option value="rarely">Rarely</option>
                      </select>
                    </label>

                    <label className="input-field">
                      Days/week you keep dry waste sorted
                      <input
                        type="number"
                        min="0"
                        max="7"
                        value={recyclingAnswers.sortedDryWasteDaysPerWeek}
                        onChange={(event) =>
                          handleRecyclingAnswerChange(
                            "sortedDryWasteDaysPerWeek",
                            Number(event.target.value)
                          )
                        }
                      />
                    </label>

                    <label className="input-field">
                      Food waste composting level
                      <select
                        value={recyclingAnswers.compostingLevel}
                        onChange={(event) =>
                          handleRecyclingAnswerChange(
                            "compostingLevel",
                            event.target.value
                          )
                        }
                      >
                        <option value="most">Most food waste composted</option>
                        <option value="some">Some composting</option>
                        <option value="none">No composting</option>
                      </select>
                    </label>
                  </div>

                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={handleRecyclingEstimateApply}
                  >
                    Estimate recycling for me
                  </button>

                  {recyclingEstimateNotice && (
                    <p className="muted waste-estimate-note">{recyclingEstimateNotice}</p>
                  )}
                </div>
              )}

              {(key === "electricity" || key === "water") && (
                <div className="bill-upload-wrap">
                  <label className="bill-upload-btn">
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          onBillUpload(key, file);
                        }
                        event.target.value = "";
                      }}
                      disabled={billUploadLoading?.[key]}
                    />
                    {billUploadLoading?.[key]
                      ? "Extracting from bill..."
                      : `Upload ${key} bill (OCR)`}
                  </label>
                  <small>Supports image or PDF bill upload.</small>
                </div>
              )}
            </div>
          ))}

          <button type="submit" className="primary-btn full-width" disabled={loading}>
            {loading ? "Running Analysis..." : "Submit for Analysis"}
          </button>
        </form>

        {error && <p className="error-text">{error}</p>}
      </article>

      <article className="card">
        <h2>Result</h2>
        {!prediction && !loading && (
          <p className="muted">
            Submit your values to view score, status, and improvement actions.
          </p>
        )}

        {loading && <p className="muted">Analyzing data with backend model...</p>}

        {prediction && (
          <div className="result-stack">
            <div className={`result-score ${status.tone}`}>
              <p>Score</p>
              <strong>{roundTo(score, 1)} / 100</strong>
              <span>{status.label}</span>
            </div>

            {prediction.sustainability_level && (
              <p className="muted">Model label: {prediction.sustainability_level}</p>
            )}
            {lastUpdated && (
              <p className="muted">
                Updated: {lastUpdated.toLocaleDateString()}{" "}
                {lastUpdated.toLocaleTimeString()}
              </p>
            )}

            <div>
              <h3>Suggestions</h3>
              <ul className="simple-list">
                {(prediction.suggestions || []).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3>What-if Simulation</h3>
              <p className="whatif-current">
                Current score: <strong>{roundTo(score, 1)}</strong>
              </p>

              {whatIfLoading && <p className="muted">Simulating improvements...</p>}

              {!whatIfLoading && whatIfResults?.length > 0 && (
                <>
                  <ul className="simple-list whatif-list">
                    {whatIfResults.map((scenario) => (
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
                    <p className="card-kicker">Graph Analysis</p>
                    <div className="whatif-bar-chart">
                      {graphRows.map((item, index) => (
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
              )}

              {whatIfError && <p className="muted">{whatIfError}</p>}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

export default AnalyzePage;

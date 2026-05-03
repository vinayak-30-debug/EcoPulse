import { useMemo, useState } from "react";

import { ESTIMATOR_DEFAULTS } from "../constants";
import { roundTo } from "../utils/scoring";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateEstimate({ people, acHours, fanHours }) {
  const electricity = people * 1.4 + acHours * 1.6 + fanHours * 0.08;
  const water = people * 135;
  const waste = people * 0.55;

  return {
    electricity: roundTo(electricity, 1),
    water: roundTo(water, 0),
    waste: roundTo(waste, 1),
  };
}

function EstimatorPage({ onApplyEstimate }) {
  const [form, setForm] = useState(ESTIMATOR_DEFAULTS);

  const estimate = useMemo(() => calculateEstimate(form), [form]);

  const handleChange = (key, value) => {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
      return;
    }

    const limits = {
      people: { min: 1, max: 15 },
      acHours: { min: 0, max: 24 },
      fanHours: { min: 0, max: 48 },
    };

    setForm((prev) => ({
      ...prev,
      [key]: clamp(numericValue, limits[key].min, limits[key].max),
    }));
  };

  return (
    <section className="page-grid">
      <article className="card">
        <h2>Usage Estimator</h2>
        <p className="muted">
          Enter quick household details and generate estimated daily usage.
        </p>

        <div className="estimator-fields">
          <label className="input-field">
            <span>Number of people in household</span>
            <input
              type="number"
              min="1"
              max="15"
              value={form.people}
              onChange={(event) => handleChange("people", event.target.value)}
            />
          </label>

          <label className="input-field">
            <span>AC usage hours (per day)</span>
            <input
              type="number"
              min="0"
              max="24"
              step="0.5"
              value={form.acHours}
              onChange={(event) => handleChange("acHours", event.target.value)}
            />
          </label>

          <label className="input-field">
            <span>Fan usage (combined hours/day)</span>
            <input
              type="number"
              min="0"
              max="48"
              step="0.5"
              value={form.fanHours}
              onChange={(event) => handleChange("fanHours", event.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="primary-btn full-width"
          onClick={() => onApplyEstimate({ inputs: estimate, people: form.people })}
        >
          Calculate and Auto-fill Analyze Inputs
        </button>
      </article>

      <article className="card estimate-card">
        <h2>Estimated Daily Usage</h2>
        <p className="muted">
          Computed from household size, AC hours, and fan usage assumptions.
        </p>

        <div className="estimate-grid">
          <div>
            <p className="card-kicker">Electricity</p>
            <strong>{estimate.electricity} kWh/day</strong>
          </div>
          <div>
            <p className="card-kicker">Water</p>
            <strong>{estimate.water} liters/day</strong>
          </div>
          <div>
            <p className="card-kicker">Waste</p>
            <strong>{estimate.waste} kg/day</strong>
          </div>
        </div>
      </article>
    </section>
  );
}

export default EstimatorPage;

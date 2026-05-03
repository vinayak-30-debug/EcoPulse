export const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "analyze", label: "Analyze" },
  { id: "monthly-report", label: "Monthly Report" },
  { id: "estimator", label: "Estimator" },
  { id: "insights", label: "Insights" },
  { id: "about", label: "About" },
];

export const DEFAULT_RECYCLING_SCORE = 60;
export const DEFAULT_HOUSEHOLD_SIZE = 4;

export const DEFAULT_ANALYZE_INPUTS = {
  electricity: 8,
  water: 150,
  waste: 1.5,
  recycling: DEFAULT_RECYCLING_SCORE,
};

export const ANALYZE_BOUNDS = {
  electricity: { min: 0, max: 50 },
  water: { min: 0, max: 1000 },
  waste: { min: 0, max: 20 },
  recycling: { min: 0, max: 100 },
};

export const AVERAGE_VALUES = {
  electricity: 8.5,
  water: 540,
  waste: 2.2,
  recycling: 60,
};

export const ANALYZE_SLIDER_CONFIG = {
  electricity: {
    label: "Electricity usage",
    unit: "kWh",
    averageUnit: "kWh/day",
    min: ANALYZE_BOUNDS.electricity.min,
    max: ANALYZE_BOUNDS.electricity.max,
    step: 0.1,
  },
  water: {
    label: "Water consumption",
    unit: "liters/day",
    averageUnit: "liters/day",
    min: ANALYZE_BOUNDS.water.min,
    max: ANALYZE_BOUNDS.water.max,
    step: 1,
  },
  waste: {
    label: "Waste generated",
    unit: "kg/day",
    averageUnit: "kg/day",
    min: ANALYZE_BOUNDS.waste.min,
    max: ANALYZE_BOUNDS.waste.max,
    step: 0.1,
  },
  recycling: {
    label: "Recycling score",
    unit: "%",
    averageUnit: "%",
    min: ANALYZE_BOUNDS.recycling.min,
    max: ANALYZE_BOUNDS.recycling.max,
    step: 1,
  },
};

export const ESTIMATOR_DEFAULTS = {
  people: 4,
  acHours: 4,
  fanHours: 12,
};

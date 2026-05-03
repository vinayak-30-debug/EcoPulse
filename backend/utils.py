from __future__ import annotations

from io import StringIO
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATASET_PATH = PROJECT_ROOT / "household_power_consumption.csv"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"

MODEL_FEATURE_COLUMNS = [
    "electricity_usage",
    "water_usage",
    "waste_generated",
    "recycling_score",
]
TARGET_COLUMN = "sustainability_score"

RAW_NUMERIC_COLUMNS = [
    "Global_active_power",
    "Global_reactive_power",
    "Voltage",
    "Global_intensity",
    "Sub_metering_1",
    "Sub_metering_2",
    "Sub_metering_3",
]

SCORING_CONFIG = {
    "electricity_usage": {"high": 15.0, "weight": 35.0},
    "water_usage": {"high": 250.0, "weight": 25.0},
    "waste_generated": {"high": 3.0, "weight": 25.0},
    "recycling_score": {"high": 1.0, "weight": 15.0},
}

SUGGESTION_THRESHOLDS = {
    "electricity": 8.0,
    "water": 150.0,
    "waste": 1.5,
    "recycling": 0.4,
}

DEFAULT_HOUSEHOLD_SIZE = 4
MIN_HOUSEHOLD_SIZE = 1
MAX_HOUSEHOLD_SIZE = 15

CONTEXT_SCORE_WEIGHTS = {
    "electricity": 0.42,
    "water": 0.33,
    "waste": 0.25,
    "usage_blend": 0.75,
    "recycling_blend": 0.25,
}


def load_dataset(csv_path: Path | str = DEFAULT_DATASET_PATH) -> pd.DataFrame:
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found at: {path}")

    return pd.read_csv(path, na_values=["?", "NA", ""])


def print_dataset_overview(df: pd.DataFrame) -> None:
    print("\n=== DATASET HEAD ===")
    print(df.head().to_string(index=False))

    print("\n=== DATASET INFO ===")
    info_buffer = StringIO()
    df.info(buf=info_buffer)
    print(info_buffer.getvalue())

    print("=== NULL VALUES ===")
    print(df.isna().sum().to_string())


def preprocess_dataset(df: pd.DataFrame) -> pd.DataFrame:
    missing_columns = [col for col in RAW_NUMERIC_COLUMNS if col not in df.columns]
    if missing_columns:
        raise ValueError(f"Missing required columns in dataset: {missing_columns}")

    clean_df = df.copy()
    for col in RAW_NUMERIC_COLUMNS:
        clean_df[col] = pd.to_numeric(clean_df[col], errors="coerce")

    clean_df[RAW_NUMERIC_COLUMNS] = clean_df[RAW_NUMERIC_COLUMNS].fillna(
        clean_df[RAW_NUMERIC_COLUMNS].median()
    )

    sub_1 = clean_df["Sub_metering_1"].clip(lower=0)
    sub_2 = clean_df["Sub_metering_2"].clip(lower=0)
    sub_3 = clean_df["Sub_metering_3"].clip(lower=0)
    sub_total = (sub_1 + sub_2 + sub_3).replace(0, np.nan)

    # Proxy mapping from available energy dataset columns to sustainability inputs.
    feature_df = pd.DataFrame(
        {
            "electricity_usage": clean_df["Global_active_power"].clip(lower=0),
            "water_usage": (clean_df["Global_intensity"].clip(lower=0) * 8.0).clip(0, 500),
            "waste_generated": ((sub_1 + sub_2) / 10.0).clip(0, 10),
            "recycling_score": (sub_3 / sub_total).fillna(0.0).clip(0, 1),
        }
    )

    return feature_df


def _ratio(value: pd.Series | float, high: float) -> pd.Series | float:
    return np.clip(np.asarray(value) / high, 0, 1)


def create_sustainability_target(feature_df: pd.DataFrame) -> pd.Series:
    electricity_impact = _ratio(
        feature_df["electricity_usage"], SCORING_CONFIG["electricity_usage"]["high"]
    ) * SCORING_CONFIG["electricity_usage"]["weight"]
    water_impact = _ratio(feature_df["water_usage"], SCORING_CONFIG["water_usage"]["high"]) * SCORING_CONFIG[
        "water_usage"
    ]["weight"]
    waste_impact = _ratio(
        feature_df["waste_generated"], SCORING_CONFIG["waste_generated"]["high"]
    ) * SCORING_CONFIG["waste_generated"]["weight"]
    recycling_bonus = _ratio(
        feature_df["recycling_score"], SCORING_CONFIG["recycling_score"]["high"]
    ) * SCORING_CONFIG["recycling_score"]["weight"]

    score = 100 - electricity_impact - water_impact - waste_impact + recycling_bonus
    return pd.Series(np.clip(score, 0, 100), index=feature_df.index).round(2)


def build_training_frame(df: pd.DataFrame) -> pd.DataFrame:
    feature_df = preprocess_dataset(df)
    feature_df[TARGET_COLUMN] = create_sustainability_target(feature_df)
    return feature_df


def split_features_target(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
    X = df[MODEL_FEATURE_COLUMNS].copy()
    y = df[TARGET_COLUMN].copy()
    return X, y


def normalize_recycling_input(recycling_value: float) -> float:
    if recycling_value < 0:
        return 0.0
    if recycling_value <= 1:
        return float(recycling_value)
    if recycling_value <= 100:
        return float(recycling_value) / 100.0
    return 1.0


def normalize_household_size(household_size: int | float | None) -> int:
    if household_size is None:
        return DEFAULT_HOUSEHOLD_SIZE
    try:
        numeric = int(round(float(household_size)))
    except (TypeError, ValueError):
        return DEFAULT_HOUSEHOLD_SIZE
    return int(max(MIN_HOUSEHOLD_SIZE, min(MAX_HOUSEHOLD_SIZE, numeric)))


def get_household_average_values(household_size: int | float | None) -> Dict[str, float]:
    people = normalize_household_size(household_size)
    return {
        "electricity": round(2.5 + people * 1.5, 1),
        "water": round(people * 135.0, 0),
        "waste": round(people * 0.55, 1),
    }


def _consumption_metric_score(value: float, baseline: float) -> float:
    if baseline <= 0:
        return 50.0

    ratio = max(float(value), 0.0) / baseline

    # Scores should remain strong when below household baseline, and degrade
    # quickly once usage is above baseline.
    if ratio <= 1.0:
        score = 100.0 - (1.0 - ratio) * 18.0
    elif ratio <= 1.5:
        score = 100.0 - (ratio - 1.0) * 90.0
    else:
        score = 55.0 - (ratio - 1.5) * 70.0

    return float(max(0.0, min(100.0, score)))


def calculate_contextual_household_score(
    electricity: float,
    water: float,
    waste: float,
    recycling: float,
    household_size: int | float | None,
) -> float:
    averages = get_household_average_values(household_size)
    recycling_score = normalize_recycling_input(recycling) * 100.0

    electricity_score = _consumption_metric_score(electricity, averages["electricity"])
    water_score = _consumption_metric_score(water, averages["water"])
    waste_score = _consumption_metric_score(waste, averages["waste"])

    usage_score = (
        electricity_score * CONTEXT_SCORE_WEIGHTS["electricity"]
        + water_score * CONTEXT_SCORE_WEIGHTS["water"]
        + waste_score * CONTEXT_SCORE_WEIGHTS["waste"]
    )
    contextual_score = (
        usage_score * CONTEXT_SCORE_WEIGHTS["usage_blend"]
        + recycling_score * CONTEXT_SCORE_WEIGHTS["recycling_blend"]
    )

    return clamp_score(contextual_score)


def calibrate_predicted_score(
    score: float,
    electricity: float,
    water: float,
    waste: float,
    recycling: float,
    household_size: int | float | None,
) -> float:
    """
    Align model output with household context so score, status, and
    suggestions remain consistent for near/below-average usage values.
    """
    raw_score = clamp_score(score)
    recycling_score = normalize_recycling_input(recycling)
    contextual_score = calculate_contextual_household_score(
        electricity=electricity,
        water=water,
        waste=waste,
        recycling=recycling,
        household_size=household_size,
    )

    blended = (raw_score * 0.45) + (contextual_score * 0.55)
    calibrated = max(raw_score, blended)

    # Strongly aligned low-usage profiles should not remain stuck in low bands.
    if contextual_score >= 84.0 and recycling_score >= 0.50:
        calibrated = max(calibrated, 72.0)
    elif contextual_score >= 75.0 and recycling_score >= 0.40:
        calibrated = max(calibrated, 64.0)

    return clamp_score(calibrated)


def get_score_calibration_context(
    score: float,
    electricity: float,
    water: float,
    waste: float,
    recycling: float,
    household_size: int | float | None,
) -> Dict[str, object]:
    raw_score = clamp_score(score)
    contextual_score = calculate_contextual_household_score(
        electricity=electricity,
        water=water,
        waste=waste,
        recycling=recycling,
        household_size=household_size,
    )
    calibrated_score = calibrate_predicted_score(
        score=raw_score,
        electricity=electricity,
        water=water,
        waste=waste,
        recycling=recycling,
        household_size=household_size,
    )
    adjustment = round(calibrated_score - raw_score, 2)
    triggered = adjustment >= 0.5

    message = ""
    if triggered:
        message = (
            "Score was adjusted using household-average context for better consistency."
        )

    return {
        "raw_score": raw_score,
        "contextual_score": contextual_score,
        "calibrated_score": calibrated_score,
        "calibration_triggered": triggered,
        "calibration_adjustment": adjustment,
        "calibration_message": message,
    }


def calculate_breakdown(
    electricity: float,
    water: float,
    waste: float,
    recycling: float,
) -> Dict[str, float]:
    recycling_score = normalize_recycling_input(recycling)

    electricity_penalty = float(
        round(
            min(electricity / SCORING_CONFIG["electricity_usage"]["high"], 1)
            * SCORING_CONFIG["electricity_usage"]["weight"],
            2,
        )
    )
    water_penalty = float(
        round(
            min(water / SCORING_CONFIG["water_usage"]["high"], 1)
            * SCORING_CONFIG["water_usage"]["weight"],
            2,
        )
    )
    waste_penalty = float(
        round(
            min(waste / SCORING_CONFIG["waste_generated"]["high"], 1)
            * SCORING_CONFIG["waste_generated"]["weight"],
            2,
        )
    )
    recycling_bonus = float(
        round(
            min(recycling_score / SCORING_CONFIG["recycling_score"]["high"], 1)
            * SCORING_CONFIG["recycling_score"]["weight"],
            2,
        )
    )

    return {
        "electricity_impact": -electricity_penalty,
        "water_impact": -water_penalty,
        "waste_impact": -waste_penalty,
        "recycling_bonus": recycling_bonus,
    }


def generate_suggestions(
    electricity: float,
    water: float,
    waste: float,
    recycling: float,
    household_size: int | float | None = DEFAULT_HOUSEHOLD_SIZE,
    score: float | None = None,
) -> List[str]:
    suggestions: List[str] = []
    recycling_score = normalize_recycling_input(recycling)
    people = normalize_household_size(household_size)
    average_values = get_household_average_values(people)
    electricity_baseline = average_values["electricity"]
    water_baseline = average_values["water"]
    waste_baseline = average_values["waste"]

    def _relative_impact(value: float, high: float, weight: float) -> float:
        # Keep this linear (without capping) for suggestion estimates to avoid flat
        # gain values when current usage is far beyond model high thresholds.
        return float((value / high) * weight)

    def _bonus(value: float, high: float, weight: float) -> float:
        return float(min(value / high, 1) * weight)

    if electricity > electricity_baseline:
        baseline = electricity_baseline
        higher_pct = ((electricity - baseline) / baseline) * 100
        current_penalty = _relative_impact(
            electricity,
            SCORING_CONFIG["electricity_usage"]["high"],
            SCORING_CONFIG["electricity_usage"]["weight"],
        )
        target_penalty = _relative_impact(
            baseline,
            SCORING_CONFIG["electricity_usage"]["high"],
            SCORING_CONFIG["electricity_usage"]["weight"],
        )
        estimated_gain = max(current_penalty - target_penalty, 0.0)
        suggestions.append(
            f"Your electricity usage is {higher_pct:.0f}% higher than average for a {people}-person household. "
            f"Reducing AC usage and switching to efficient appliances can improve your score by ~{estimated_gain:.1f} points."
        )
        suggestions.append(
            "Use AC at 24-26C and clean filters monthly to reduce power draw without hurting comfort."
        )
        if electricity >= baseline * 1.5:
            suggestions.append(
                "Shift heavy appliances (washing machine/geyser) to shorter, scheduled cycles to cut peak electricity use."
            )
    if water > water_baseline:
        baseline = water_baseline
        higher_pct = ((water - baseline) / baseline) * 100
        current_penalty = _relative_impact(
            water,
            SCORING_CONFIG["water_usage"]["high"],
            SCORING_CONFIG["water_usage"]["weight"],
        )
        target_penalty = _relative_impact(
            baseline,
            SCORING_CONFIG["water_usage"]["high"],
            SCORING_CONFIG["water_usage"]["weight"],
        )
        estimated_gain = max(current_penalty - target_penalty, 0.0)
        suggestions.append(
            f"Your water usage is {higher_pct:.0f}% higher than average for a {people}-person household. "
            f"Fixing leakages and using low-flow fixtures can improve your score by ~{estimated_gain:.1f} points."
        )
        suggestions.append(
            "Install tap aerators and use bucket-based cleaning where possible to lower daily water demand."
        )
        if water >= baseline * 1.4:
            suggestions.append(
                "Reuse RO reject or laundry rinse water for mopping and flushing to save potable water."
            )
    if waste > waste_baseline:
        baseline = waste_baseline
        higher_pct = ((waste - baseline) / baseline) * 100
        current_penalty = _relative_impact(
            waste,
            SCORING_CONFIG["waste_generated"]["high"],
            SCORING_CONFIG["waste_generated"]["weight"],
        )
        target_penalty = _relative_impact(
            baseline,
            SCORING_CONFIG["waste_generated"]["high"],
            SCORING_CONFIG["waste_generated"]["weight"],
        )
        estimated_gain = max(current_penalty - target_penalty, 0.0)
        suggestions.append(
            f"Your waste generation is {higher_pct:.0f}% higher than average for a {people}-person household. "
            f"Composting and better segregation can improve your score by ~{estimated_gain:.1f} points."
        )
        suggestions.append(
            "Start a 2-bin + 1-bag setup (wet, dry, sanitary/e-waste) to improve segregation quality."
        )
        if waste >= baseline * 1.4:
            suggestions.append(
                "Plan weekly meals and buy in bulk/refill packs to reduce packaging and food waste."
            )
    if recycling_score < SUGGESTION_THRESHOLDS["recycling"]:
        target = SUGGESTION_THRESHOLDS["recycling"]
        below_pct = ((target - recycling_score) / target) * 100
        current_bonus = _bonus(
            recycling_score,
            SCORING_CONFIG["recycling_score"]["high"],
            SCORING_CONFIG["recycling_score"]["weight"],
        )
        target_bonus = _bonus(
            target,
            SCORING_CONFIG["recycling_score"]["high"],
            SCORING_CONFIG["recycling_score"]["weight"],
        )
        estimated_gain = max(target_bonus - current_bonus, 0.0)
        suggestions.append(
            f"Your recycling level is {below_pct:.0f}% below target. "
            f"Improving segregation of plastic, paper, and e-waste can improve your score by ~{estimated_gain:.1f} points."
        )
        suggestions.append(
            "Keep labeled dry-waste bags for paper, plastic, and metal to make recycling easier each day."
        )

    if electricity > electricity_baseline and water > water_baseline:
        suggestions.append(
            "Track electricity and water weekly on one dashboard so trend changes are visible before bills rise."
        )

    if not suggestions:
        normalized_score = clamp_score(score) if score is not None else None
        if normalized_score is not None and normalized_score >= 75:
            suggestions.append(
                "Excellent profile. Your household usage is efficient for your family size."
            )
        elif normalized_score is not None and normalized_score >= 60:
            suggestions.append(
                "Good progress. Most inputs are in a healthy range for your household size."
            )
        else:
            suggestions.append(
                "Your usage is close to the recommended range, with room for targeted improvements."
            )

        suggestions.extend(
            [
                "Maintain this by tracking weekly trends and reacting early to unusual spikes.",
                "Keep one monthly review habit for electricity, water, and waste together.",
            ]
        )

        if recycling_score < 0.7:
            suggestions.append(
                "Improving recycling consistency can unlock additional sustainability gains."
            )
        else:
            suggestions.append(
                "Your recycling consistency is strong. Keep this routine stable."
            )

    # Keep output readable and avoid repeated suggestions.
    deduped: List[str] = []
    seen = set()
    for item in suggestions:
        key = item.strip().lower()
        if key in seen:
            continue
        deduped.append(item)
        seen.add(key)

    return deduped[:8]


def get_top_contributing_factor(
    feature_importances: Dict[str, float],
    electricity: float,
    water: float,
    waste: float,
    recycling: float,
) -> str:
    contribution_scores = get_contribution_scores(
        feature_importances=feature_importances,
        electricity=electricity,
        water=water,
        waste=waste,
        recycling=recycling,
    )
    return max(contribution_scores, key=contribution_scores.get)


def get_contribution_scores(
    feature_importances: Dict[str, float],
    electricity: float,
    water: float,
    waste: float,
    recycling: float,
) -> Dict[str, float]:
    recycling_score = normalize_recycling_input(recycling)

    feature_intensity = {
        "electricity_usage": min(electricity / SCORING_CONFIG["electricity_usage"]["high"], 1),
        "water_usage": min(water / SCORING_CONFIG["water_usage"]["high"], 1),
        "waste_generated": min(waste / SCORING_CONFIG["waste_generated"]["high"], 1),
        "recycling_score": 1 - min(
            recycling_score / SCORING_CONFIG["recycling_score"]["high"], 1
        ),
    }

    # Fallback to scoring weights if model importances are missing/zero.
    if not feature_importances or sum(feature_importances.values()) <= 0:
        feature_importances = {
            "electricity_usage": SCORING_CONFIG["electricity_usage"]["weight"],
            "water_usage": SCORING_CONFIG["water_usage"]["weight"],
            "waste_generated": SCORING_CONFIG["waste_generated"]["weight"],
            "recycling_score": SCORING_CONFIG["recycling_score"]["weight"],
        }

    weighted = {
        feature: feature_importances.get(feature, 0.0) * intensity
        for feature, intensity in feature_intensity.items()
    }
    return {k: float(round(v, 4)) for k, v in weighted.items()}


def normalize_feature_importance(feature_importances: Dict[str, float]) -> Dict[str, float]:
    if not feature_importances:
        return {}

    filtered = {feature: float(feature_importances.get(feature, 0.0)) for feature in MODEL_FEATURE_COLUMNS}
    total = sum(filtered.values())
    if total <= 0:
        return filtered

    normalized = {feature: value / total for feature, value in filtered.items()}
    return {k: float(round(v, 4)) for k, v in normalized.items()}


def get_sustainability_level(score: float) -> str:
    if score < 40:
        return "Beginner 🌱"
    if score < 70:
        return "Moderate 🌿"
    return "Eco Hero 🌳"


def clamp_score(score: float) -> float:
    return float(round(max(0.0, min(100.0, score)), 2))

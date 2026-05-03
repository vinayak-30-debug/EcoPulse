from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

import joblib
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from utils import (
    DEFAULT_MODEL_PATH,
    MODEL_FEATURE_COLUMNS,
    calculate_breakdown,
    clamp_score,
    generate_suggestions,
    get_score_calibration_context,
    get_contribution_scores,
    get_sustainability_level,
    get_top_contributing_factor,
    normalize_household_size,
    normalize_feature_importance,
    normalize_recycling_input,
)

router = APIRouter(tags=["prediction"])


class PredictionInput(BaseModel):
    electricity: float = Field(..., ge=0, le=50, description="Electricity usage value")
    water: float = Field(..., ge=0, le=1000, description="Water usage value")
    waste: float = Field(..., ge=0, le=20, description="Waste generated value")
    recycling: float = Field(
        ...,
        ge=0,
        le=100,
        description="Recycling score. Accepts 0-1 or 0-100.",
    )
    household_size: int = Field(
        4,
        ge=1,
        le=15,
        description="Number of people in household for dynamic average-based suggestions.",
    )


@lru_cache(maxsize=1)
def load_model_artifact(model_path: str = str(DEFAULT_MODEL_PATH)) -> Dict[str, Any]:
    path = Path(model_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Model file not found at {path}. Train it first using model_training.py."
        )

    artifact = joblib.load(path)
    required = {"model", "feature_columns", "feature_importance"}
    if not required.issubset(artifact.keys()):
        raise ValueError(
            "Invalid model artifact format. Retrain with model_training.py to regenerate model.pkl."
        )

    return artifact


@router.get("/model-info")
def model_info():
    try:
        artifact = load_model_artifact()
        return {
            "feature_columns": artifact.get("feature_columns", MODEL_FEATURE_COLUMNS),
            "feature_importance": artifact.get("feature_importance", {}),
            "metrics": artifact.get("metrics", {}),
            "trained_at_utc": artifact.get("trained_at_utc"),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load model info: {exc}") from exc


@router.post("/predict")
def predict_score(payload: PredictionInput):
    try:
        artifact = load_model_artifact()
        model = artifact["model"]
        feature_columns: List[str] = artifact.get("feature_columns", MODEL_FEATURE_COLUMNS)
        feature_importance: Dict[str, float] = artifact.get("feature_importance", {})

        recycling_score = normalize_recycling_input(payload.recycling)
        household_size = normalize_household_size(payload.household_size)

        features = {
            "electricity_usage": float(payload.electricity),
            "water_usage": float(payload.water),
            "waste_generated": float(payload.waste),
            "recycling_score": float(recycling_score),
        }

        input_df = pd.DataFrame([features], columns=feature_columns)
        score_context = get_score_calibration_context(
            score=float(model.predict(input_df)[0]),
            electricity=payload.electricity,
            water=payload.water,
            waste=payload.waste,
            recycling=recycling_score,
            household_size=household_size,
        )
        raw_model_score = float(score_context["raw_score"])
        score = float(score_context["calibrated_score"])

        breakdown = calculate_breakdown(
            electricity=payload.electricity,
            water=payload.water,
            waste=payload.waste,
            recycling=recycling_score,
        )
        suggestions = generate_suggestions(
            electricity=payload.electricity,
            water=payload.water,
            waste=payload.waste,
            recycling=recycling_score,
            household_size=household_size,
            score=score,
        )
        top_factor = get_top_contributing_factor(
            feature_importances=feature_importance,
            electricity=payload.electricity,
            water=payload.water,
            waste=payload.waste,
            recycling=recycling_score,
        )
        contribution_scores = get_contribution_scores(
            feature_importances=feature_importance,
            electricity=payload.electricity,
            water=payload.water,
            waste=payload.waste,
            recycling=recycling_score,
        )
        normalized_feature_importance = normalize_feature_importance(feature_importance)
        sustainability_level = get_sustainability_level(score)

        return {
            "score": score,
            "raw_model_score": raw_model_score,
            "calibration_triggered": bool(score_context["calibration_triggered"]),
            "calibration_adjustment": float(score_context["calibration_adjustment"]),
            "calibration_message": str(score_context["calibration_message"]),
            "sustainability_level": sustainability_level,
            "breakdown": breakdown,
            "suggestions": suggestions,
            "top_factor": top_factor,
            "feature_importance": normalized_feature_importance,
            "contribution_scores": contribution_scores,
            "household_size": household_size,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc

"""
Backward-compatible helper module.
Main inference logic now lives in predict.py.
"""

from pathlib import Path

import joblib
import pandas as pd

MODEL_PATH = Path(__file__).resolve().with_name("model.pkl")


def _load_model():
    artifact = joblib.load(MODEL_PATH)
    return artifact["model"]


def predict_score(electricity, water, waste, recycling):
    model = _load_model()
    features = pd.DataFrame(
        [
            {
                "electricity_usage": float(electricity),
                "water_usage": float(water),
                "waste_generated": float(waste),
                "recycling_score": float(recycling),
            }
        ]
    )
    pred = model.predict(features)[0]
    return round(float(pred), 2)

from __future__ import annotations

import argparse

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from utils import (
    DEFAULT_DATASET_PATH,
    DEFAULT_MODEL_PATH,
    MODEL_FEATURE_COLUMNS,
    SCORING_CONFIG,
    SUGGESTION_THRESHOLDS,
    TARGET_COLUMN,
    build_training_frame,
    load_dataset,
    print_dataset_overview,
    split_features_target,
)


def _safe_text(value: object) -> str:
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train sustainability score model.")
    parser.add_argument(
        "--data",
        type=str,
        default=str(DEFAULT_DATASET_PATH),
        help="Path to household CSV dataset.",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(DEFAULT_MODEL_PATH),
        help="Path to save trained model artifact (.pkl).",
    )
    parser.add_argument(
        "--max-rows",
        type=int,
        default=200_000,
        help="Optional row cap for faster local training. Use 0 to disable.",
    )
    parser.add_argument("--test-size", type=float, default=0.2, help="Test split size.")
    parser.add_argument("--random-state", type=int, default=42, help="Random seed.")
    parser.add_argument(
        "--noise-std",
        type=float,
        default=8.0,
        help="Std deviation for Gaussian noise added to target score.",
    )
    parser.add_argument(
        "--feature-jitter",
        type=float,
        default=0.04,
        help="Multiplicative jitter strength to reduce deterministic feature-target coupling.",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=10,
        help="Max depth for RandomForestRegressor.",
    )
    return parser.parse_args()


def add_controlled_noise_to_target(
    df: pd.DataFrame,
    noise_std: float,
    random_state: int,
) -> pd.DataFrame:
    noisy_df = df.copy()
    rng = np.random.default_rng(random_state)

    noise = rng.normal(0, noise_std, len(noisy_df))
    noisy_df[TARGET_COLUMN] = np.clip(noisy_df[TARGET_COLUMN].to_numpy() + noise, 0, 100).round(2)
    return noisy_df


def add_feature_jitter(
    df: pd.DataFrame,
    jitter_strength: float,
    random_state: int,
) -> pd.DataFrame:
    jittered_df = df.copy()
    rng = np.random.default_rng(random_state + 1)

    for col in MODEL_FEATURE_COLUMNS:
        values = jittered_df[col].to_numpy(dtype=float)

        if col == "recycling_score":
            values = values + rng.normal(0, jitter_strength * 0.35, len(values))
            jittered_df[col] = np.clip(values, 0, 1)
            continue

        multiplier = rng.normal(1.0, jitter_strength, len(values))
        values = values * multiplier

        # Keep values in realistic range and avoid introducing impossible negatives.
        upper = float(np.percentile(df[col], 99.5) * 1.15)
        jittered_df[col] = np.clip(values, 0, upper)

    return jittered_df


def build_training_pipeline(random_state: int, max_depth: int) -> Pipeline:
    return Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            (
                "model",
                RandomForestRegressor(
                    n_estimators=100,
                    max_depth=max_depth,
                    random_state=random_state,
                    n_jobs=1,
                    min_samples_leaf=3,
                    min_samples_split=6,
                ),
            ),
        ]
    )


def train_model(
    df: pd.DataFrame,
    test_size: float,
    random_state: int,
    max_depth: int,
) -> Tuple[Pipeline, Dict[str, float], Dict[str, float]]:
    X, y = split_features_target(df)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state
    )

    pipeline = build_training_pipeline(random_state=random_state, max_depth=max_depth)

    cv_scores = cross_val_score(
        pipeline,
        X_train,
        y_train,
        cv=5,
        scoring="r2",
        n_jobs=1,
    )

    pipeline.fit(X_train, y_train)
    predictions = pipeline.predict(X_test)

    metrics = {
        "r2_score": float(r2_score(y_test, predictions)),
        "mse": float(mean_squared_error(y_test, predictions)),
        "cv_r2_mean": float(np.mean(cv_scores)),
        "cv_r2_std": float(np.std(cv_scores)),
    }

    trained_model = pipeline.named_steps["model"]
    feature_importances = {
        feature: float(importance)
        for feature, importance in zip(MODEL_FEATURE_COLUMNS, trained_model.feature_importances_)
    }

    return pipeline, metrics, feature_importances


def preprocess_training_data(
    raw_df: pd.DataFrame,
    max_rows: int,
    random_state: int,
    noise_std: float,
    feature_jitter: float,
) -> pd.DataFrame:
    training_df = build_training_frame(raw_df)

    # Handle missing values before sampling/training.
    missing_before = int(training_df.isna().sum().sum())
    if missing_before > 0:
        training_df = training_df.fillna(training_df.mean(numeric_only=True))
        training_df = training_df.dropna()
        missing_after = int(training_df.isna().sum().sum())
        print(f"\nMissing values handled: before={missing_before}, after={missing_after}")

    if max_rows and max_rows > 0 and len(training_df) > max_rows:
        training_df = training_df.sample(n=max_rows, random_state=random_state).reset_index(drop=True)
        print(f"\nUsing sampled rows for training: {len(training_df)}")
    else:
        training_df = training_df.reset_index(drop=True)
        print(f"\nUsing full dataset rows for training: {len(training_df)}")

    training_df = add_feature_jitter(
        training_df,
        jitter_strength=feature_jitter,
        random_state=random_state,
    )
    training_df = add_controlled_noise_to_target(
        training_df,
        noise_std=noise_std,
        random_state=random_state,
    )

    return training_df


def main() -> None:
    args = parse_args()

    dataset_path = Path(args.data)
    output_path = Path(args.output)

    print(f"Loading dataset from: {_safe_text(dataset_path)}")
    raw_df = load_dataset(dataset_path)
    print_dataset_overview(raw_df)

    training_df = preprocess_training_data(
        raw_df=raw_df,
        max_rows=args.max_rows,
        random_state=args.random_state,
        noise_std=args.noise_std,
        feature_jitter=args.feature_jitter,
    )

    model, metrics, feature_importance = train_model(
        training_df,
        test_size=args.test_size,
        random_state=args.random_state,
        max_depth=args.max_depth,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    top_feature = max(feature_importance.items(), key=lambda item: item[1])
    artifact = {
        "model": model,
        "feature_columns": MODEL_FEATURE_COLUMNS,
        "feature_importance": feature_importance,
        "scoring_config": SCORING_CONFIG,
        "suggestion_thresholds": SUGGESTION_THRESHOLDS,
        "metrics": metrics,
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
    }

    joblib.dump(artifact, output_path)

    print("\n=== TRAINING METRICS ===")
    print(f"R2 Score: {metrics['r2_score']:.4f}")
    print(f"MSE: {metrics['mse']:.4f}")
    print(f"Cross-validation R2 (5-fold): {metrics['cv_r2_mean']:.4f} +/- {metrics['cv_r2_std']:.4f}")

    print("\n=== FEATURE IMPORTANCE ===")
    for feature, importance in sorted(feature_importance.items(), key=lambda x: x[1], reverse=True):
        print(f"{feature}: {importance:.4f}")
    print(f"\nMost important feature: {top_feature[0]} ({top_feature[1]:.4f})")

    print(f"\nModel artifact saved to: {_safe_text(output_path)}")


if __name__ == "__main__":
    main()

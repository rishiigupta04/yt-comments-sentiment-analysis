import json
import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import yaml

from sklearn.preprocessing import LabelEncoder
from transformers import AutoTokenizer


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)


def load_params():
    with open("params.yaml", "r") as f:
        return yaml.safe_load(f)


def save_json(data, path):
    with open(path, "w") as f:
        json.dump(data, f, indent=4)


def main():

    params = load_params()

    cfg = params["feature_engineering"]

    train_path = cfg["train_path"]
    val_path = cfg["val_path"]
    test_path = cfg["test_path"]

    model_name = cfg["model_name"]

    output_dir = Path(cfg["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Loading datasets...")

    train_df = pd.read_parquet(train_path)
    val_df = pd.read_parquet(val_path)
    test_df = pd.read_parquet(test_path)

    logger.info(f"Train shape : {train_df.shape}")
    logger.info(f"Val shape   : {val_df.shape}")
    logger.info(f"Test shape  : {test_df.shape}")

    logger.info("Building LabelEncoder...")

    le = LabelEncoder()

    le.fit(train_df["Sentiment"])

    y_train = le.transform(train_df["Sentiment"])
    y_val = le.transform(val_df["Sentiment"])
    y_test = le.transform(test_df["Sentiment"])

    np.save(output_dir / "y_train.npy", y_train)
    np.save(output_dir / "y_val.npy", y_val)
    np.save(output_dir / "y_test.npy", y_test)

    joblib.dump(
        le,
        output_dir / "label_encoder.pkl"
    )

    logger.info("Downloading tokenizer...")

    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        use_fast=True
    )

    tokenizer_dir = output_dir / "tokenizer"

    tokenizer.save_pretrained(
        tokenizer_dir
    )

    report = {

        "train_rows": int(len(train_df)),
        "val_rows": int(len(val_df)),
        "test_rows": int(len(test_df)),

        "classes": le.classes_.tolist(),

        "num_classes": len(le.classes_),

        "tokenizer": model_name
    }

    save_json(
        report,
        output_dir / "feature_report.json"
    )

    logger.info("Feature Engineering Completed Successfully")


if __name__ == "__main__":
    main()
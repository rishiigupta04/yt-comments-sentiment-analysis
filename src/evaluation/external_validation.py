import json
import logging
from pathlib import Path

import pandas as pd
import numpy as np
import torch
import joblib

from sklearn.metrics import (
    accuracy_score,
    f1_score,
    classification_report,
    confusion_matrix
)

from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification
)

# ==================================================
# LOGGING
# ==================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)

# ==================================================
# PATHS
# ==================================================

MODEL_PATH = Path(
    "artifacts/models/best_model.pt"
)

CONFIG_PATH = Path(
    "artifacts/models/model_config.json"
)

TOKENIZER_PATH = Path(
    "artifacts/features/tokenizer"
)

LABEL_ENCODER_PATH = Path(
    "artifacts/features/label_encoder.pkl"
)

EXTERNAL_DATA_PATH = Path(
    "data/external/real_world_comments.csv"
)

OUTPUT_DIR = Path(
    "artifacts/external_validation"
)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True
)

# ==================================================
# DEVICE
# ==================================================

DEVICE = (
    "cuda"
    if torch.cuda.is_available()
    else "cpu"
)

# ==================================================
# LOAD MODEL
# ==================================================

logger.info(
    "Loading model..."
)

with open(
    CONFIG_PATH,
    "r"
) as f:

    model_cfg = json.load(f)

tokenizer = AutoTokenizer.from_pretrained(
    TOKENIZER_PATH
)

label_encoder = joblib.load(
    LABEL_ENCODER_PATH
)

model = (
    AutoModelForSequenceClassification
    .from_pretrained(
        model_cfg["model_name"]
    )
)

state_dict = torch.load(
    MODEL_PATH,
    map_location=DEVICE
)

model.load_state_dict(
    state_dict
)

model.to(
    DEVICE
)

model.eval()

logger.info(
    "Model Loaded"
)

# ==================================================
# LOAD DATA
# ==================================================

df = pd.read_csv(
    EXTERNAL_DATA_PATH
)

logger.info(
    f"Rows: {len(df)}"
)

# ==================================================
# PREDICTION
# ==================================================

predictions = []
confidences = []

with torch.no_grad():

    for text in df["CommentText"]:

        encoded = tokenizer(

            str(text),

            truncation=True,

            padding=True,

            max_length=192,

            return_tensors="pt"
        )

        encoded = {

            k: v.to(DEVICE)

            for k, v in encoded.items()
        }

        outputs = model(
            **encoded
        )

        probs = torch.softmax(

            outputs.logits,

            dim=1
        )

        pred_idx = (
            torch.argmax(
                probs,
                dim=1
            )
            .item()
        )

        confidence = (
            probs.max()
            .item()
        )

        pred_label = (
            label_encoder
            .inverse_transform(
                [pred_idx]
            )[0]
        )

        predictions.append(
            pred_label
        )

        confidences.append(
            confidence
        )

# ==================================================
# RESULTS
# ==================================================

df["PredictedSentiment"] = (
    predictions
)

df["Confidence"] = (
    confidences
)

# ==================================================
# METRICS
# ==================================================

y_true = (
    df["ExpectedSentiment"]
    .str.lower()
    .str.strip()
)

y_pred = (
    df["PredictedSentiment"]
    .str.lower()
    .str.strip()
)

metrics = {

    "accuracy":
        float(
            accuracy_score(
                y_true,
                y_pred
            )
        ),

    "macro_f1":
        float(
            f1_score(
                y_true,
                y_pred,
                average="macro"
            )
        ),

    "weighted_f1":
        float(
            f1_score(
                y_true,
                y_pred,
                average="weighted"
            )
        )
}

# ==================================================
# REPORT
# ==================================================

report = classification_report(
    y_true,
    y_pred,
    output_dict=True
)

with open(
    OUTPUT_DIR /
    "classification_report.json",
    "w"
) as f:

    json.dump(
        report,
        f,
        indent=4
    )

# ==================================================
# CONFUSION MATRIX
# ==================================================

cm = confusion_matrix(
    y_true,
    y_pred
)

pd.DataFrame(cm).to_csv(

    OUTPUT_DIR /
    "confusion_matrix.csv",

    index=False
)

# ==================================================
# SAVE PREDICTIONS
# ==================================================

df.to_csv(

    OUTPUT_DIR /
    "external_predictions.csv",

    index=False
)

# ==================================================
# SAVE METRICS
# ==================================================

with open(
    OUTPUT_DIR /
    "external_validation.json",
    "w"
) as f:

    json.dump(
        metrics,
        f,
        indent=4
    )

# ==================================================
# SAVE MISTAKES
# ==================================================

mistakes = df[
    y_true != y_pred
]

mistakes.to_csv(

    OUTPUT_DIR /
    "mistakes.csv",

    index=False
)

# ==================================================
# PRINT
# ==================================================

logger.info("=" * 60)

logger.info(
    f"Accuracy : {metrics['accuracy']:.4f}"
)

logger.info(
    f"Macro F1 : {metrics['macro_f1']:.4f}"
)

logger.info(
    f"Weighted F1 : {metrics['weighted_f1']:.4f}"
)

logger.info("=" * 60)

logger.info(
    f"Mistakes: {len(mistakes)}"
)

logger.info(
    "External Validation Complete"
)


print(df.head())
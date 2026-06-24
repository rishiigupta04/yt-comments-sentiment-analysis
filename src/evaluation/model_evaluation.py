import json
import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix
)

from torch.utils.data import Dataset, DataLoader

from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification
)

# =====================================================
# LOGGING
# =====================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)

# =====================================================
# PATHS
# =====================================================

BASE_DIR = Path("artifacts")

MODEL_DIR = BASE_DIR / "models"

FEATURE_DIR = BASE_DIR / "features"

OUTPUT_DIR = BASE_DIR / "evaluation"

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True
)

TEST_DATA_PATH = (
    Path("data/processed/test.parquet")
)

MODEL_PATH = (
    MODEL_DIR / "best_model.pt"
)

MODEL_CONFIG_PATH = (
    MODEL_DIR / "model_config.json"
)

LABEL_ENCODER_PATH = (
    FEATURE_DIR / "label_encoder.pkl"
)

TOKENIZER_PATH = (
    FEATURE_DIR / "tokenizer"
)

# =====================================================
# GPU
# =====================================================

DEVICE = (
    "cuda"
    if torch.cuda.is_available()
    else "cpu"
)

logger.info(
    f"Using Device: {DEVICE}"
)

# =====================================================
# DATASET
# =====================================================

class EvaluationDataset(Dataset):

    def __init__(
        self,
        texts,
        labels,
        tokenizer,
        max_length=192
    ):

        self.texts = texts
        self.labels = labels
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self):

        return len(self.texts)

    def __getitem__(self, idx):

        encoding = self.tokenizer(
            str(self.texts[idx]),
            truncation=True,
            padding="max_length",
            max_length=self.max_length,
            return_tensors="pt"
        )

        return {

            "input_ids":
                encoding["input_ids"]
                .squeeze(0),

            "attention_mask":
                encoding["attention_mask"]
                .squeeze(0),

            "label":
                torch.tensor(
                    self.labels[idx],
                    dtype=torch.long
                )
        }

# =====================================================
# LOAD ARTIFACTS
# =====================================================

def load_tokenizer():

    logger.info(
        "Loading tokenizer..."
    )

    tokenizer = AutoTokenizer.from_pretrained(
        TOKENIZER_PATH
    )

    return tokenizer


def load_label_encoder():

    logger.info(
        "Loading LabelEncoder..."
    )

    return joblib.load(
        LABEL_ENCODER_PATH
    )


def load_model():

    logger.info(
        "Loading model config..."
    )

    with open(
        MODEL_CONFIG_PATH,
        "r"
    ) as f:

        config = json.load(f)

    model_name = config["model_name"]

    logger.info(
        f"Model: {model_name}"
    )

    model = (
        AutoModelForSequenceClassification
        .from_pretrained(
            model_name
        )
    )

    logger.info(
        "Loading best_model.pt..."
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
        "Model Loaded Successfully"
    )

    return model

# =====================================================
# TEST DATA
# =====================================================

def load_test_data():

    logger.info(
        "Loading test dataset..."
    )

    df = pd.read_parquet(
        TEST_DATA_PATH
    )

    logger.info(
        f"Test Shape: {df.shape}"
    )

    return df

# =====================================================
# DATALOADER
# =====================================================

def build_dataloader(
    df,
    tokenizer,
    label_encoder,
    batch_size=32
):

    labels = label_encoder.transform(
        df["Sentiment"]
    )

    dataset = EvaluationDataset(
        texts=df["CommentText"].tolist(),
        labels=labels,
        tokenizer=tokenizer
    )

    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=2,
        pin_memory=True
    )

    return loader

# =====================================================
# INFERENCE
# =====================================================

@torch.no_grad()
def predict(
    model,
    dataloader
):

    all_preds = []

    all_probs = []

    all_labels = []

    logger.info(
        "Running inference..."
    )

    for batch in dataloader:

        input_ids = (
            batch["input_ids"]
            .to(DEVICE)
        )

        attention_mask = (
            batch["attention_mask"]
            .to(DEVICE)
        )

        labels = (
            batch["label"]
            .cpu()
            .numpy()
        )

        outputs = model(
            input_ids=input_ids,
            attention_mask=attention_mask
        )

        logits = outputs.logits

        probs = torch.softmax(
            logits,
            dim=1
        )

        preds = torch.argmax(
            probs,
            dim=1
        )

        all_preds.extend(
            preds.cpu().numpy()
        )

        all_probs.extend(
            probs.cpu().numpy()
        )

        all_labels.extend(
            labels
        )

    return (

        np.array(all_labels),

        np.array(all_preds),

        np.array(all_probs)
    )

# =====================================================
# METRICS
# =====================================================

def compute_metrics(
    y_true,
    y_pred
):

    metrics = {

        "accuracy":
            float(
                accuracy_score(
                    y_true,
                    y_pred
                )
            ),

        "precision_macro":
            float(
                precision_score(
                    y_true,
                    y_pred,
                    average="macro"
                )
            ),

        "recall_macro":
            float(
                recall_score(
                    y_true,
                    y_pred,
                    average="macro"
                )
            ),

        "f1_macro":
            float(
                f1_score(
                    y_true,
                    y_pred,
                    average="macro"
                )
            ),

        "f1_weighted":
            float(
                f1_score(
                    y_true,
                    y_pred,
                    average="weighted"
                )
            )
    }

    return metrics


# =====================================================
# REPORTS
# =====================================================

def save_classification_report(
    y_true,
    y_pred,
    label_encoder
):

    report = classification_report(
        y_true,
        y_pred,
        target_names=label_encoder.classes_
    )

    report_path = (
        OUTPUT_DIR /
        "classification_report.txt"
    )

    with open(
        report_path,
        "w",
        encoding="utf-8"
    ) as f:

        f.write(report)

    logger.info(
        "classification_report.txt saved"
    )

    return report


# =====================================================
# CONFUSION MATRIX
# =====================================================

def save_confusion_matrix(
    y_true,
    y_pred,
    label_encoder
):

    cm = confusion_matrix(
        y_true,
        y_pred
    )

    plt.figure(
        figsize=(8, 6)
    )

    sns.heatmap(
        cm,
        annot=True,
        fmt="d",
        cmap="Blues",
        xticklabels=label_encoder.classes_,
        yticklabels=label_encoder.classes_
    )

    plt.xlabel(
        "Predicted"
    )

    plt.ylabel(
        "Actual"
    )

    plt.title(
        "Confusion Matrix"
    )

    plt.tight_layout()

    plt.savefig(
        OUTPUT_DIR /
        "confusion_matrix.png"
    )

    plt.close()

    logger.info(
        "confusion_matrix.png saved"
    )


# =====================================================
# NORMALIZED CONFUSION MATRIX
# =====================================================

def save_normalized_confusion_matrix(
    y_true,
    y_pred,
    label_encoder
):

    cm = confusion_matrix(
        y_true,
        y_pred
    )

    cm = (
        cm.astype(float)
        /
        cm.sum(axis=1)[:, np.newaxis]
    )

    plt.figure(
        figsize=(8, 6)
    )

    sns.heatmap(
        cm,
        annot=True,
        fmt=".2f",
        cmap="Greens",
        xticklabels=label_encoder.classes_,
        yticklabels=label_encoder.classes_
    )

    plt.xlabel(
        "Predicted"
    )

    plt.ylabel(
        "Actual"
    )

    plt.title(
        "Normalized Confusion Matrix"
    )

    plt.tight_layout()

    plt.savefig(
        OUTPUT_DIR /
        "normalized_confusion_matrix.png"
    )

    plt.close()

    logger.info(
        "normalized_confusion_matrix.png saved"
    )


# =====================================================
# PREDICTION DISTRIBUTION
# =====================================================

def save_prediction_distribution(
    y_pred,
    label_encoder
):

    labels = (
        label_encoder.inverse_transform(
            y_pred
        )
    )

    counts = (
        pd.Series(labels)
        .value_counts()
        .sort_index()
    )

    plt.figure(
        figsize=(8, 5)
    )

    counts.plot(
        kind="bar"
    )

    plt.title(
        "Prediction Distribution"
    )

    plt.ylabel(
        "Count"
    )

    plt.tight_layout()

    plt.savefig(
        OUTPUT_DIR /
        "prediction_distribution.png"
    )

    plt.close()

    logger.info(
        "prediction_distribution.png saved"
    )


# =====================================================
# CONFIDENCE DISTRIBUTION
# =====================================================

def save_confidence_distribution(
    probabilities
):

    confidence = (
        probabilities.max(axis=1)
    )

    plt.figure(
        figsize=(8, 5)
    )

    plt.hist(
        confidence,
        bins=30
    )

    plt.title(
        "Prediction Confidence Distribution"
    )

    plt.xlabel(
        "Confidence"
    )

    plt.ylabel(
        "Frequency"
    )

    plt.tight_layout()

    plt.savefig(
        OUTPUT_DIR /
        "confidence_distribution.png"
    )

    plt.close()

    logger.info(
        "confidence_distribution.png saved"
    )


# =====================================================
# MISCLASSIFIED SAMPLES
# =====================================================

def save_misclassified_samples(
    df,
    y_true,
    y_pred,
    probabilities,
    label_encoder
):

    confidence = (
        probabilities.max(axis=1)
    )

    actual = (
        label_encoder.inverse_transform(
            y_true
        )
    )

    predicted = (
        label_encoder.inverse_transform(
            y_pred
        )
    )

    mask = (
        actual != predicted
    )

    errors = pd.DataFrame({

        "CommentText":
            df.loc[
                mask,
                "CommentText"
            ].values,

        "Actual":
            actual[mask],

        "Predicted":
            predicted[mask],

        "Confidence":
            confidence[mask]
    })

    errors = errors.sort_values(
        by="Confidence",
        ascending=False
    )

    errors.to_csv(

        OUTPUT_DIR /
        "misclassified_samples.csv",

        index=False
    )

    logger.info(
        "misclassified_samples.csv saved"
    )


# =====================================================
# SAVE SUMMARY
# =====================================================

def save_summary(
    metrics
):

    summary_path = (
        OUTPUT_DIR /
        "evaluation_summary.json"
    )

    with open(
        summary_path,
        "w"
    ) as f:

        json.dump(
            metrics,
            f,
            indent=4
        )

    logger.info(
        "evaluation_summary.json saved"
    )


# =====================================================
# MAIN
# =====================================================

def main():

    tokenizer = load_tokenizer()

    label_encoder = (
        load_label_encoder()
    )

    model = load_model()

    test_df = load_test_data()

    dataloader = build_dataloader(

        test_df,

        tokenizer,

        label_encoder,

        batch_size=32
    )

    y_true, y_pred, probs = predict(

        model,

        dataloader
    )

    metrics = compute_metrics(

        y_true,

        y_pred
    )

    save_summary(
        metrics
    )

    save_classification_report(

        y_true,

        y_pred,

        label_encoder
    )

    save_confusion_matrix(

        y_true,

        y_pred,

        label_encoder
    )

    save_normalized_confusion_matrix(

        y_true,

        y_pred,

        label_encoder
    )

    save_prediction_distribution(

        y_pred,

        label_encoder
    )

    save_confidence_distribution(
        probs
    )

    save_misclassified_samples(

        test_df,

        y_true,

        y_pred,

        probs,

        label_encoder
    )

    logger.info(
        "=" * 50
    )

    logger.info(
        "Evaluation Complete"
    )

    logger.info(
        json.dumps(
            metrics,
            indent=4
        )
    )

    logger.info(
        "=" * 50
    )


if __name__ == "__main__":

    main()
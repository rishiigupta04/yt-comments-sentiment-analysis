import json
import logging
from pathlib import Path

import joblib
import numpy as np
import torch

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

ARTIFACT_DIR = Path("artifacts")

MODEL_DIR = ARTIFACT_DIR / "models"

FEATURE_DIR = ARTIFACT_DIR / "features"

MODEL_PATH = (
    MODEL_DIR /
    "best_model.pt"
)

MODEL_CONFIG_PATH = (
    MODEL_DIR /
    "model_config.json"
)

TOKENIZER_PATH = (
    FEATURE_DIR /
    "tokenizer"
)

LABEL_ENCODER_PATH = (
    FEATURE_DIR /
    "label_encoder.pkl"
)

# =====================================================
# DEVICE
# =====================================================

DEVICE = (
    "cuda"
    if torch.cuda.is_available()
    else "cpu"
)

# =====================================================
# PREPROCESSOR
# =====================================================

class TextPreprocessor:

    def preprocess(
        self,
        text
    ):

        if text is None:
            return ""

        return str(text).strip()

# =====================================================
# PREDICTOR
# =====================================================

class SentimentPredictor:

    def __init__(self):

        logger.info(
            f"Using Device: {DEVICE}"
        )

        self.device = DEVICE

        self.preprocessor = (
            TextPreprocessor()
        )

        logger.info(
            "Loading tokenizer..."
        )

        self.tokenizer = (
            AutoTokenizer
            .from_pretrained(
                TOKENIZER_PATH
            )
        )

        logger.info(
            "Loading label encoder..."
        )

        self.label_encoder = (
            joblib.load(
                LABEL_ENCODER_PATH
            )
        )

        logger.info(
            "Loading model config..."
        )

        with open(
            MODEL_CONFIG_PATH,
            "r"
        ) as f:

            self.config = (
                json.load(f)
            )

        logger.info(
            "Loading model..."
        )

        self.model = (
            AutoModelForSequenceClassification
            .from_pretrained(
                self.config[
                    "model_name"
                ]
            )
        )

        state_dict = torch.load(

            MODEL_PATH,

            map_location=
            self.device
        )

        self.model.load_state_dict(
            state_dict
        )

        self.model.to(
            self.device
        )

        self.model.eval()

        logger.info(
            "Model Loaded Successfully"
        )

    # =================================================
    # SINGLE PREDICTION
    # =================================================

    @torch.no_grad()
    def predict(
        self,
        text
    ):

        text = (
            self.preprocessor
            .preprocess(text)
        )

        encoded = self.tokenizer(

            text,

            truncation=True,

            padding=True,

            max_length=192,

            return_tensors="pt"
        )

        input_ids = (
            encoded["input_ids"]
            .to(self.device)
        )

        attention_mask = (
            encoded["attention_mask"]
            .to(self.device)
        )

        outputs = self.model(

            input_ids=input_ids,

            attention_mask=
            attention_mask
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

        sentiment = (
            self.label_encoder
            .inverse_transform(
                [pred_idx]
            )[0]
        )

        return {

            "sentiment":
                sentiment,

            "confidence":
                round(
                    confidence,
                    4
                )
        }

    # =================================================
    # BATCH PREDICTION
    # =================================================

    @torch.no_grad()
    def predict_batch(
        self,
        texts,
        batch_size=64
    ):

        results = []

        for i in range(

            0,

            len(texts),

            batch_size
        ):

            batch = texts[
                i:i+batch_size
            ]

            batch = [

                self.preprocessor
                .preprocess(t)

                for t in batch
            ]

            encoded = self.tokenizer(

                batch,

                truncation=True,

                padding=True,

                max_length=192,

                return_tensors="pt"
            )

            input_ids = (
                encoded["input_ids"]
                .to(self.device)
            )

            attention_mask = (
                encoded["attention_mask"]
                .to(self.device)
            )

            outputs = self.model(

                input_ids=input_ids,

                attention_mask=
                attention_mask
            )

            probs = torch.softmax(

                outputs.logits,

                dim=1
            )

            preds = torch.argmax(

                probs,

                dim=1
            )

            probs = (
                probs.cpu()
                .numpy()
            )

            preds = (
                preds.cpu()
                .numpy()
            )

            sentiments = (

                self.label_encoder
                .inverse_transform(
                    preds
                )
            )

            for sentiment, prob in zip(

                sentiments,

                probs
            ):

                results.append({

                    "sentiment":
                        sentiment,

                    "confidence":
                        float(
                            np.max(
                                prob
                            )
                        )
                })

        return results
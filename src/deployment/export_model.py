import json
from pathlib import Path

import torch

from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer
)

# ==========================================
# PATHS
# ==========================================

MODEL_DIR = Path(
    "artifacts/models"
)

FEATURE_DIR = Path(
    "artifacts/features"
)

OUTPUT_DIR = Path(
    "artifacts/deployment_model"
)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True
)

# ==========================================
# LOAD CONFIG
# ==========================================

with open(
    MODEL_DIR / "model_config.json",
    "r"
) as f:

    cfg = json.load(f)

model_name = cfg["model_name"]

print(
    f"Loading {model_name}"
)

# ==========================================
# LOAD MODEL
# ==========================================

model = (
    AutoModelForSequenceClassification
    .from_pretrained(
        model_name
    )
)

state_dict = torch.load(

    MODEL_DIR /
    "best_model.pt",

    map_location="cpu"
)

model.load_state_dict(
    state_dict
)

# ==========================================
# LOAD TOKENIZER
# ==========================================

tokenizer = (
    AutoTokenizer
    .from_pretrained(
        FEATURE_DIR /
        "tokenizer"
    )
)

# ==========================================
# SAVE HF FORMAT
# ==========================================

model.save_pretrained(
    OUTPUT_DIR
)

tokenizer.save_pretrained(
    OUTPUT_DIR
)

print(
    "Deployment package saved"
)
import os
import re
import json
import yaml
import joblib
import logging
import random
import unicodedata

from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd

from tqdm import tqdm

from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score
)

from sklearn.utils.class_weight import (
    compute_class_weight
)

import torch
import torch.nn as nn
import torch.nn.functional as F

from torch.optim import AdamW

from torch.utils.data import (
    Dataset,
    DataLoader
)

from transformers import (

    AutoTokenizer,

    AutoModelForSequenceClassification,

    get_cosine_schedule_with_warmup
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
# REPRODUCIBILITY
# =====================================================

def set_seed(seed=42):

    random.seed(seed)

    np.random.seed(seed)

    torch.manual_seed(seed)

    torch.cuda.manual_seed_all(seed)


# =====================================================
# CONFIG
# =====================================================

def load_config():

    with open("params.yaml","r") as f:

        params = yaml.safe_load(f)

    return params["training"]


# =====================================================
# GPU AUTO CONFIG
# =====================================================

def get_gpu_config():

    if not torch.cuda.is_available():

        logger.warning(
            "CUDA NOT AVAILABLE"
        )

        return {

            "device":"cpu",

            "batch_size":8,

            "grad_accum":4,

            "fp16":False,

            "grad_checkpointing":False
        }

    gpu_name = torch.cuda.get_device_name(0)

    gpu_mem = (

        torch.cuda.get_device_properties(0)
        .total_memory

        /

        1024**3
    )

    logger.info(
        f"GPU: {gpu_name}"
    )

    logger.info(
        f"VRAM: {gpu_mem:.2f} GB"
    )

    if gpu_mem <= 4.5:

        cfg = {

            "batch_size":8,

            "grad_accum":4,

            "fp16":True,

            "grad_checkpointing":True
        }

    elif gpu_mem <= 6.5:

        cfg = {

            "batch_size":16,

            "grad_accum":2,

            "fp16":True,

            "grad_checkpointing":True
        }

    else:

        cfg = {

            "batch_size":32,

            "grad_accum":1,

            "fp16":True,

            "grad_checkpointing":False
        }

    cfg["device"] = "cuda"

    return cfg


# =====================================================
# TEXT PREPROCESSOR
# =====================================================

class TransformerTextPreprocessor:

    def __init__(self):

        self.url_re = re.compile(
            r"https?://\S+|www\.\S+"
        )

        self.mention_re = re.compile(
            r"@\w+"
        )

        self.repeat_re = re.compile(
            r"(.)\1{3,}"
        )

        self.space_re = re.compile(
            r"\s+"
        )

    def preprocess(self,text):

        if not isinstance(text,str):

            return ""

        text = unicodedata.normalize(
            "NFKC",
            text
        )

        text = self.url_re.sub(
            "http",
            text
        )

        text = self.mention_re.sub(
            "@user",
            text
        )

        text = self.repeat_re.sub(
            r"\1\1",
            text
        )

        text = self.space_re.sub(
            " ",
            text
        )

        return text.strip()

    def preprocess_batch(self,texts):

        return [

            self.preprocess(x)

            for x in texts
        ]


# =====================================================
# DATASET
# =====================================================

class YoutubeCommentDataset(Dataset):

    def __init__(

        self,

        texts,

        labels,

        tokenizer,

        max_length
    ):

        self.texts = texts

        self.labels = labels

        self.tokenizer = tokenizer

        self.max_length = max_length

    def __len__(self):

        return len(self.texts)

    def __getitem__(self,idx):

        enc = self.tokenizer(

            self.texts[idx],

            truncation=True,

            max_length=self.max_length,

            return_tensors="pt"
        )

        return {

            "input_ids":
                enc["input_ids"].squeeze(0),

            "attention_mask":
                enc["attention_mask"].squeeze(0),

            "labels":
                torch.tensor(
                    self.labels[idx],
                    dtype=torch.long
                )
        }


# =====================================================
# COLLATOR
# =====================================================

class DynamicPaddingCollator:

    def __init__(self,tokenizer):

        self.tokenizer = tokenizer

    def __call__(self,batch):

        ids = [

            x["input_ids"]

            for x in batch
        ]

        masks = [

            x["attention_mask"]

            for x in batch
        ]

        labels = torch.stack(

            [

                x["labels"]

                for x in batch
            ]
        )

        padded = self.tokenizer.pad(

            {

                "input_ids":ids,

                "attention_mask":masks
            },

            return_tensors="pt"
        )

        padded["labels"] = labels

        return padded


# =====================================================
# LOAD DATA
# =====================================================

def load_datasets():

    train_df = pd.read_parquet(
        "data/processed/train.parquet"
    )

    val_df = pd.read_parquet(
        "data/processed/val.parquet"
    )

    test_df = pd.read_parquet(
        "data/processed/test.parquet"
    )

    return train_df,val_df,test_df


# =====================================================
# DATALOADERS
# =====================================================

def build_dataloaders(

    cfg,

    gpu_cfg,

    tokenizer
):

    train_df,val_df,test_df = load_datasets()

    from sklearn.model_selection import train_test_split

    if cfg.get("train_sample_size"):
        train_df, _ = train_test_split(
            train_df,
            train_size=cfg["train_sample_size"],
            stratify=train_df["Sentiment"],
            random_state=42
        )

        logger.info(
            f"Using stratified sample: {len(train_df):,} rows"
        )


    preprocessor = (
        TransformerTextPreprocessor()
    )

    train_texts = preprocessor.preprocess_batch(
        train_df["CommentText"]
    )

    val_texts = preprocessor.preprocess_batch(
        val_df["CommentText"]
    )

    test_texts = preprocessor.preprocess_batch(
        test_df["CommentText"]
    )

    label_encoder = joblib.load(
        "artifacts/features/label_encoder.pkl"
    )

    y_train = label_encoder.transform(
        train_df["Sentiment"]
    )

    y_val = label_encoder.transform(
        val_df["Sentiment"]
    )

    y_test = label_encoder.transform(
        test_df["Sentiment"]
    )

    train_ds = YoutubeCommentDataset(
        train_texts,
        y_train,
        tokenizer,
        cfg["max_length"]
    )

    val_ds = YoutubeCommentDataset(
        val_texts,
        y_val,
        tokenizer,
        cfg["max_length"]
    )

    test_ds = YoutubeCommentDataset(
        test_texts,
        y_test,
        tokenizer,
        cfg["max_length"]
    )

    collator = DynamicPaddingCollator(
        tokenizer
    )

    train_loader = DataLoader(

        train_ds,

        batch_size=
        gpu_cfg["batch_size"],

        shuffle=True,

        pin_memory=True,

        num_workers=0,

        collate_fn=collator
    )

    val_loader = DataLoader(

        val_ds,

        batch_size=
        gpu_cfg["batch_size"],

        shuffle=False,

        pin_memory=True,

        num_workers=0,

        collate_fn=collator
    )

    test_loader = DataLoader(

        test_ds,

        batch_size=
        gpu_cfg["batch_size"],

        shuffle=False,

        pin_memory=True,

        num_workers=0,

        collate_fn=collator
    )

    return (

        train_loader,

        val_loader,

        test_loader,

        label_encoder,

        y_train
    )



# =====================================================
# MODEL
# =====================================================

def freeze_layers(

    model,

    freeze_layers
):

    for p in model.roberta.embeddings.parameters():

        p.requires_grad = False

    for layer in model.roberta.encoder.layer[:freeze_layers]:

        for p in layer.parameters():

            p.requires_grad = False

    logger.info(

        f"Froze embeddings + "

        f"first {freeze_layers} layers"
    )


def build_model(

    cfg,

    gpu_cfg
):

    logger.info(
        "Loading backbone..."
    )

    model = AutoModelForSequenceClassification.from_pretrained(

        cfg["model_name"]

    )

    freeze_layers(

        model,

        cfg["freeze_layers"]
    )

    if gpu_cfg["grad_checkpointing"]:

        if hasattr(model, "gradient_checkpointing_enable"):
            model.gradient_checkpointing_enable()

        logger.info(

            "Gradient Checkpointing Enabled"
        )

    return model


# =====================================================
# CLASS WEIGHTS
# =====================================================

def get_class_weights(y_train):

    weights = compute_class_weight(

        class_weight="balanced",

        classes=np.unique(y_train),

        y=y_train
    )

    logger.info(

        f"Class Weights: "

        f"{weights}"
    )

    return torch.tensor(

        weights,

        dtype=torch.float
    )


# =====================================================
# FP16 SAFE FOCAL LOSS
# =====================================================

class FocalLoss(nn.Module):

    def __init__(

        self,

        alpha=None,

        gamma=2.0
    ):

        super().__init__()

        self.alpha = alpha

        self.gamma = gamma

    def forward(

        self,

        logits,

        targets
    ):

        with torch.autocast(

            device_type=

            "cuda"

            if logits.is_cuda

            else

            "cpu",

            enabled=False
        ):

            logits = logits.float()

            ce_loss = F.cross_entropy(

                logits,

                targets,

                reduction="none",

                weight=self.alpha
            )

            pt = torch.exp(
                -ce_loss
            )

            focal = (

                (1 - pt)

                **

                self.gamma
            )

            loss = (

                focal

                *

                ce_loss

            ).mean()

        return loss


# =====================================================
# CRITERION
# =====================================================

def build_criterion(

    cfg,

    class_weights
):

    if cfg["loss_type"] == "focal":

        logger.info(

            f"Using Focal Loss "

            f"(gamma={cfg['focal_gamma']})"
        )

        return FocalLoss(

            alpha=class_weights,

            gamma=cfg["focal_gamma"]
        )

    logger.info(
        "Using Weighted CE"
    )

    return nn.CrossEntropyLoss(

        weight=class_weights
    )


# =====================================================
# LLRD OPTIMIZER
# =====================================================

def build_llrd_optimizer(

    model,

    lr_head,

    lr_backbone,

    weight_decay,

    layer_decay
):

    param_groups = []

    no_decay = [

        "bias",

        "LayerNorm.weight"
    ]

    n_layers = len(

        model.roberta.encoder.layer
    )

    for i, layer in enumerate(

        model.roberta.encoder.layer
    ):

        lr = (

            lr_backbone

            *

            (

                layer_decay

                **

                (

                    n_layers

                    -

                    i

                    -

                    1
                )
            )
        )

        decay_params = []

        no_decay_params = []

        for name, param in layer.named_parameters():

            if not param.requires_grad:

                continue

            if any(

                nd in name

                for nd in no_decay
            ):

                no_decay_params.append(
                    param
                )

            else:

                decay_params.append(
                    param
                )

        if decay_params:

            param_groups.append(

                {

                    "params":
                        decay_params,

                    "lr":
                        lr,

                    "weight_decay":
                        weight_decay
                }
            )

        if no_decay_params:

            param_groups.append(

                {

                    "params":
                        no_decay_params,

                    "lr":
                        lr,

                    "weight_decay":
                        0.0
                }
            )

    head_params = [

        p

        for n, p

        in model.named_parameters()

        if (
                not n.startswith("roberta")
                and
                p.requires_grad
        )
    ]

    param_groups.append(

        {

            "params":
                head_params,

            "lr":
                lr_head,

            "weight_decay":
                weight_decay
        }
    )

    logger.info(

        f"LLRD Enabled | "

        f"Head LR={lr_head} | "

        f"Backbone LR={lr_backbone}"
    )

    return AdamW(
        param_groups
    )


# =====================================================
# COSINE SCHEDULER
# =====================================================

def build_scheduler(

    optimizer,

    total_steps,

    warmup_ratio
):

    warmup_steps = int(

        total_steps

        *

        warmup_ratio
    )

    logger.info(

        f"Warmup Steps: "

        f"{warmup_steps:,}"
    )

    return get_cosine_schedule_with_warmup(

        optimizer,

        num_warmup_steps=
        warmup_steps,

        num_training_steps=
        total_steps
    )


# =====================================================
# CHECKPOINT SAVE
# =====================================================

def save_checkpoint(

    path,

    model,

    optimizer,

    scheduler,

    scaler,

    epoch,

    best_f1
):

    torch.save(

        {

            "model":
                model.state_dict(),

            "optimizer":
                optimizer.state_dict(),

            "scheduler":
                scheduler.state_dict(),

            "scaler":
                scaler.state_dict(),

            "epoch":
                epoch,

            "best_f1":
                best_f1
        },

        path
    )


# =====================================================
# CHECKPOINT LOAD
# =====================================================

def load_checkpoint(

    path,

    model,

    optimizer,

    scheduler,

    scaler
):

    checkpoint = torch.load(

        path,

        map_location="cpu"
    )

    model.load_state_dict(

        checkpoint["model"]
    )

    optimizer.load_state_dict(

        checkpoint["optimizer"]
    )

    scheduler.load_state_dict(

        checkpoint["scheduler"]
    )

    scaler.load_state_dict(

        checkpoint["scaler"]
    )

    logger.info(

        f"Resumed From Epoch "

        f"{checkpoint['epoch']}"
    )

    return (

        checkpoint["epoch"],

        checkpoint["best_f1"]
    )


# =====================================================
# EVALUATION
# =====================================================

@torch.no_grad()
def evaluate(

    model,

    loader,

    device,

    criterion
):

    model.eval()

    preds = []

    labels = []

    running_loss = 0.0

    for batch in loader:

        input_ids = (

            batch["input_ids"]
            .to(device)
        )

        attention_mask = (

            batch["attention_mask"]
            .to(device)
        )

        y = (

            batch["labels"]
            .to(device)
        )

        logits = model(

            input_ids=input_ids,

            attention_mask=
            attention_mask

        ).logits

        loss = criterion(

            logits,

            y
        )

        running_loss += loss.item()

        pred = torch.argmax(

            logits,

            dim=1
        )

        preds.extend(

            pred.cpu().numpy()
        )

        labels.extend(

            y.cpu().numpy()
        )

    macro_f1 = f1_score(

        labels,

        preds,

        average="macro"
    )

    accuracy = accuracy_score(

        labels,

        preds
    )

    val_loss = (

        running_loss

        /

        len(loader)
    )

    return {

        "val_loss":
            val_loss,

        "macro_f1":
            macro_f1,

        "accuracy":
            accuracy,

        "preds":
            preds,

        "labels":
            labels
    }


# =====================================================
# TRAINING LOOP
# =====================================================


def train_model(

    model,

    train_loader,

    val_loader,

    optimizer,

    scheduler,

    criterion,

    cfg,

    gpu_cfg,

    output_dir
):

    device = gpu_cfg["device"]

    grad_accum = gpu_cfg["grad_accum"]

    fp16 = gpu_cfg["fp16"]

    epochs = cfg["epochs"]

    patience = cfg["patience"]

    scaler = torch.amp.GradScaler(
        "cuda",
        enabled=(fp16 and device == "cuda")
    )

    best_f1 = 0.0

    patience_counter = 0

    start_epoch = 1

    history = []

    checkpoint_path = (
        output_dir /
        "last_state.pt"
    )

    # ==========================================
    # RESUME
    # ==========================================

    if cfg["resume"]:

        if checkpoint_path.exists():

            logger.info(
                "Resuming training..."
            )

            start_epoch, best_f1 = load_checkpoint(

                checkpoint_path,

                model,

                optimizer,

                scheduler,

                scaler
            )

            start_epoch += 1

    model.to(device)

    # ==========================================
    # EPOCH LOOP
    # ==========================================

    for epoch in range(

        start_epoch,

        epochs + 1

    ):

        logger.info(
            f"\nEpoch {epoch}/{epochs}"
        )

        model.train()

        running_loss = 0.0

        optimizer.zero_grad(
            set_to_none=True
        )

        progress_bar = tqdm(

            enumerate(train_loader),

            total=len(train_loader)
        )

        for step, batch in progress_bar:

            input_ids = (

                batch["input_ids"]

                .to(device)
            )

            attention_mask = (

                batch["attention_mask"]

                .to(device)
            )

            labels = (

                batch["labels"]

                .to(device)
            )

            with torch.amp.autocast(
                "cuda",
                enabled=(
                    fp16
                    and
                    device == "cuda"
                )
            ):

                outputs = model(

                    input_ids=input_ids,

                    attention_mask=
                    attention_mask
                )

                logits = outputs.logits

                loss = criterion(

                    logits,

                    labels
                )

                loss = (
                    loss /
                    grad_accum
                )

            scaler.scale(
                loss
            ).backward()

            if (

                (step + 1)
                %
                grad_accum
                ==
                0

                or

                (step + 1)
                ==
                len(train_loader)

            ):

                scaler.unscale_(
                    optimizer
                )

                torch.nn.utils.clip_grad_norm_(

                    model.parameters(),

                    max_norm=1.0
                )

                scaler.step(
                    optimizer
                )

                scaler.update()

                scheduler.step()

                optimizer.zero_grad(
                    set_to_none=True
                )



            running_loss += (

                loss.item()

                *

                grad_accum
            )

            progress_bar.set_postfix(

                train_loss=
                running_loss
                /
                (step + 1)
            )

        train_loss = (

            running_loss

            /

            len(train_loader)
        )

        # ======================================
        # VALIDATION
        # ======================================

        val_metrics = evaluate(

            model,

            val_loader,

            device,

            criterion
        )

        val_loss = (
            val_metrics["val_loss"]
        )

        val_f1 = (
            val_metrics["macro_f1"]
        )

        val_acc = (
            val_metrics["accuracy"]
        )

        logger.info(

            f"train_loss={train_loss:.4f} | "

            f"val_loss={val_loss:.4f} | "

            f"val_f1={val_f1:.4f} | "

            f"val_acc={val_acc:.4f}"
        )

        history.append({

            "epoch":
                epoch,

            "train_loss":
                train_loss,

            "val_loss":
                val_loss,

            "val_f1":
                val_f1,

            "val_accuracy":
                val_acc
        })

        # ======================================
        # SAVE CHECKPOINT
        # ======================================

        save_checkpoint(

            checkpoint_path,

            model,

            optimizer,

            scheduler,

            scaler,

            epoch,

            best_f1
        )

        # ======================================
        # BEST MODEL
        # ======================================

        if val_f1 > best_f1:

            best_f1 = val_f1

            patience_counter = 0

            torch.save(

                model.state_dict(),

                output_dir /
                "best_model.pt"
            )

            logger.info(

                f"New Best Model Saved "

                f"(F1={best_f1:.4f})"
            )

        else:

            patience_counter += 1

            logger.info(

                f"No Improvement "

                f"({patience_counter}/{patience})"
            )

            if (

                patience_counter

                >=

                patience

            ):

                logger.info(
                    "Early Stopping Triggered"
                )

                break

    history_df = pd.DataFrame(
        history
    )

    history_df.to_csv(

        output_dir /
        "training_history.csv",

        index=False
    )

    return best_f1


# =====================================================
# FINAL TEST EVALUATION
# =====================================================

def run_final_evaluation(

    model,

    test_loader,

    label_encoder,

    criterion,

    device,

    output_dir
):

    logger.info(
        "Running Final Evaluation..."
    )

    results = evaluate(

        model,

        test_loader,

        device,

        criterion
    )

    report = classification_report(

        results["labels"],

        results["preds"],

        target_names=
        label_encoder.classes_,

        output_dict=True
    )

    evaluation = {

        "accuracy":

            float(
                results["accuracy"]
            ),

        "macro_f1":

            float(
                results["macro_f1"]
            ),

        "test_loss":

            float(
                results["val_loss"]
            ),

        "classification_report":

            report
    }

    with open(

        output_dir /
        "evaluation.json",

        "w"

    ) as f:

        json.dump(

            evaluation,

            f,

            indent=4
        )

    logger.info(
        "evaluation.json saved"
    )


# =====================================================
# MAIN
# =====================================================

def main():

    cfg = load_config()

    set_seed(42)

    gpu_cfg = get_gpu_config()

    device = gpu_cfg["device"]

    output_dir = Path(
        cfg["output_dir"]
    )

    output_dir.mkdir(

        parents=True,

        exist_ok=True
    )

    logger.info(
        "Loading tokenizer..."
    )

    tokenizer = AutoTokenizer.from_pretrained(

        "artifacts/features/tokenizer"
    )

    logger.info(
        "Building dataloaders..."
    )

    (

        train_loader,

        val_loader,

        test_loader,

        label_encoder,

        y_train

    ) = build_dataloaders(

        cfg,

        gpu_cfg,

        tokenizer
    )

    logger.info(
        "Loading model..."
    )

    model = build_model(

        cfg,

        gpu_cfg
    )

    model.to(device)

    class_weights = (

        get_class_weights(
            y_train
        )

        .to(device)
    )

    criterion = build_criterion(

        cfg,

        class_weights
    )

    optimizer = build_llrd_optimizer(

        model,

        cfg["lr_head"],

        cfg["lr_backbone"],

        cfg["weight_decay"],

        cfg["layer_decay"]
    )

    total_steps = (

        len(train_loader)

        *

        cfg["epochs"]

    )

    scheduler = build_scheduler(

        optimizer,

        total_steps,

        cfg["warmup_ratio"]
    )

    logger.info(
        "Starting Training..."
    )

    best_f1 = train_model(

        model,

        train_loader,

        val_loader,

        optimizer,

        scheduler,

        criterion,

        cfg,

        gpu_cfg,

        output_dir
    )

    logger.info(

        f"Best Validation F1: "

        f"{best_f1:.4f}"
    )

    model.load_state_dict(

        torch.load(

            output_dir /
            "best_model.pt",

            map_location=device
        )
    )

    run_final_evaluation(

        model,

        test_loader,

        label_encoder,

        criterion,

        device,

        output_dir
    )

    model_config = {

        "timestamp":

            datetime.now().strftime(
                "%Y-%m-%d %H:%M:%S"
            ),

        "model_name":

            cfg["model_name"],

        "freeze_layers":

            cfg["freeze_layers"],

        "batch_size":

            gpu_cfg["batch_size"],

        "grad_accum":

            gpu_cfg["grad_accum"],

        "fp16":

            gpu_cfg["fp16"],

        "gradient_checkpointing":

            gpu_cfg["grad_checkpointing"],

        "epochs":

            cfg["epochs"],

        "best_val_f1":

            float(best_f1)
    }

    with open(

        output_dir /
        "model_config.json",

        "w"

    ) as f:

        json.dump(

            model_config,

            f,

            indent=4
        )

    logger.info(
        "Training Complete"
    )


if __name__ == "__main__":

    main()
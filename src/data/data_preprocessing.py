import json
import logging
import re
import unicodedata
from pathlib import Path

import pandas as pd
import yaml

from sklearn.model_selection import train_test_split


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)


# ============================================================
# PARAMS
# ============================================================

def load_params():
    with open("params.yaml", "r") as f:
        return yaml.safe_load(f)


# ============================================================
# TRANSFORMER PREPROCESSOR
# ============================================================

class TransformerTextPreprocessor:

    def __init__(self):

        self.url_re = re.compile(
            r"https?://\S+|www\.\S+"
        )

        self.mention_re = re.compile(
            r"@\w+"
        )

        self.html_re = re.compile(
            r"<[^>]+>"
        )

        self.amp_re = re.compile(
            r"&amp;|&lt;|&gt;|&quot;|&#39;"
        )

        self.repeat_re = re.compile(
            r"(.)\1{3,}"
        )

        self.multi_space = re.compile(
            r"\s+"
        )

    def preprocess(self, text):

        if not isinstance(text, str):
            return ""

        if not text.strip():
            return ""

        text = unicodedata.normalize(
            "NFKC",
            text
        )

        text = self.html_re.sub(
            " ",
            text
        )

        text = self.amp_re.sub(
            " ",
            text
        )

        text = self.mention_re.sub(
            "@user",
            text
        )

        text = self.url_re.sub(
            "http",
            text
        )

        text = self.repeat_re.sub(
            r"\1\1",
            text
        )

        text = self.multi_space.sub(
            " ",
            text
        ).strip()

        return text

    def preprocess_batch(self, texts):

        return [
            self.preprocess(t)
            for t in texts
        ]


# ============================================================
# STRATIFIED SPLIT
# ============================================================

def stratified_split(
    df,
    label_col,
    test_size,
    val_size,
    seed
):

    train_val_df, test_df = train_test_split(
        df,
        test_size=test_size,
        stratify=df[label_col],
        random_state=seed
    )

    val_ratio = val_size / (
        1 - test_size
    )

    train_df, val_df = train_test_split(
        train_val_df,
        test_size=val_ratio,
        stratify=train_val_df[label_col],
        random_state=seed
    )

    logger.info(
        f"Train: {len(train_df):,}"
    )

    logger.info(
        f"Val: {len(val_df):,}"
    )

    logger.info(
        f"Test: {len(test_df):,}"
    )

    return (
        train_df.reset_index(drop=True),
        val_df.reset_index(drop=True),
        test_df.reset_index(drop=True)
    )


# ============================================================
# SAVE OUTPUTS
# ============================================================

def save_outputs(
    train_df,
    val_df,
    test_df,
    output_dir
):

    output_dir = Path(output_dir)

    output_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    train_path = (
        output_dir /
        "train.parquet"
    )

    val_path = (
        output_dir /
        "val.parquet"
    )

    test_path = (
        output_dir /
        "test.parquet"
    )

    report_path = (
        output_dir /
        "preprocessing_report.json"
    )

    train_df.to_parquet(
        train_path,
        index=False
    )

    val_df.to_parquet(
        val_path,
        index=False
    )

    test_df.to_parquet(
        test_path,
        index=False
    )

    report = {

        "train_rows": int(
            len(train_df)
        ),

        "val_rows": int(
            len(val_df)
        ),

        "test_rows": int(
            len(test_df)
        ),

        "train_distribution":
            train_df["Sentiment"]
            .value_counts()
            .to_dict(),

        "val_distribution":
            val_df["Sentiment"]
            .value_counts()
            .to_dict(),

        "test_distribution":
            test_df["Sentiment"]
            .value_counts()
            .to_dict()
    }

    with open(
        report_path,
        "w"
    ) as f:

        json.dump(
            report,
            f,
            indent=4
        )

    logger.info(
        "Saved processed datasets."
    )


# ============================================================
# MAIN
# ============================================================

def main():

    params = load_params()

    cfg = params[
        "data_preprocessing"
    ]

    logger.info(
        "Loading cleaned dataset..."
    )

    df = pd.read_parquet(
        cfg["input_path"]
    )

    logger.info(
        f"Loaded: {df.shape}"
    )

    train_df, val_df, test_df = (
        stratified_split(
            df=df,
            label_col="Sentiment",
            test_size=cfg["test_size"],
            val_size=cfg["val_size"],
            seed=cfg["random_state"]
        )
    )

    logger.info(
        "Applying TransformerTextPreprocessor..."
    )

    preprocessor = (
        TransformerTextPreprocessor()
    )

    train_df["CommentText"] = (
        preprocessor.preprocess_batch(
            train_df["CommentText"]
        )
    )

    val_df["CommentText"] = (
        preprocessor.preprocess_batch(
            val_df["CommentText"]
        )
    )

    test_df["CommentText"] = (
        preprocessor.preprocess_batch(
            test_df["CommentText"]
        )
    )

    save_outputs(
        train_df,
        val_df,
        test_df,
        cfg["output_dir"]
    )

    logger.info(
        "Stage 2 completed successfully."
    )


if __name__ == "__main__":
    main()
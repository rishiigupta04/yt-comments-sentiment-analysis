import json
import logging
from pathlib import Path

import pandas as pd
import yaml
from ftfy import fix_text


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
# LOAD DATA
# ============================================================

def load_data(csv_path):

    logger.info(f"Loading dataset: {csv_path}")

    df = pd.read_csv(
        csv_path,
        low_memory=False
    )

    logger.info(
        f"Loaded dataset shape: {df.shape}"
    )

    return df


# ============================================================
# VALIDATE COLUMNS
# ============================================================

def validate_columns(df):

    required_cols = [
        "CommentID",
        "VideoID",
        "VideoTitle",
        "AuthorName",
        "AuthorChannelID",
        "CommentText",
        "Sentiment",
        "Likes",
        "Replies",
        "PublishedAt",
        "CountryCode",
        "CategoryID"
    ]

    missing = [
        col
        for col in required_cols
        if col not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Missing columns: {missing}"
        )

    logger.info(
        "Column validation successful."
    )

    return df[required_cols].copy()


# ============================================================
# FIX MOJIBAKE
# ============================================================

def fix_mojibake(df):

    logger.info(
        "Fixing mojibake using ftfy..."
    )

    text_columns = [
        "CommentText",
        "VideoTitle",
        "AuthorName"
    ]

    for col in text_columns:

        df[col] = df[col].apply(
            lambda x:
            fix_text(x)
            if isinstance(x, str)
            else x
        )

    return df


# ============================================================
# CLEAN TYPES
# ============================================================

def clean_types(df):

    logger.info(
        "Cleaning column types..."
    )

    df["Likes"] = (
        pd.to_numeric(
            df["Likes"],
            errors="coerce"
        )
        .fillna(0)
        .astype("int32")
    )

    df["Replies"] = (
        pd.to_numeric(
            df["Replies"],
            errors="coerce"
        )
        .fillna(0)
        .astype("int32")
    )

    df["CategoryID"] = (
        pd.to_numeric(
            df["CategoryID"],
            errors="coerce"
        )
        .fillna(0)
        .astype("int16")
    )

    df["PublishedAt"] = pd.to_datetime(
        df["PublishedAt"],
        errors="coerce"
    )

    df["Sentiment"] = (
        df["Sentiment"]
        .astype(str)
        .str.lower()
        .str.strip()
    )

    df["CountryCode"] = (
        df["CountryCode"]
        .astype(str)
        .str.upper()
        .str.strip()
    )

    df["CommentText"] = (
        df["CommentText"]
        .astype(str)
        .str.strip()
    )

    df["VideoTitle"] = (
        df["VideoTitle"]
        .astype(str)
        .str.strip()
    )

    return df


# ============================================================
# REMOVE INVALID ROWS
# ============================================================

def remove_invalid(df):

    valid_sentiments = {
        "positive",
        "negative",
        "neutral"
    }

    before = len(df)

    df = df[
        df["Sentiment"]
        .isin(valid_sentiments)
    ]

    df = df[
        df["CommentText"]
        .str.len() > 1
    ]

    df = df[
        df["PublishedAt"]
        .notna()
    ]

    removed = before - len(df)

    logger.info(
        f"Removed {removed:,} invalid rows"
    )

    return df.reset_index(drop=True)


# ============================================================
# DEDUPLICATE
# ============================================================

def deduplicate(df):

    before = len(df)

    df = df.drop_duplicates(
        subset=[
            "CommentText",
            "VideoID"
        ],
        keep="first"
    )

    removed = before - len(df)

    logger.info(
        f"Removed {removed:,} duplicates"
    )

    return df.reset_index(drop=True)


# ============================================================
# SAVE OUTPUTS
# ============================================================

def save_outputs(df, output_dir):

    output_dir = Path(output_dir)

    output_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    parquet_path = (
        output_dir /
        "cleaned_data.parquet"
    )

    report_path = (
        output_dir /
        "ingestion_report.json"
    )

    df.to_parquet(
        parquet_path,
        index=False
    )

    report = {
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "sentiment_distribution":
            df["Sentiment"]
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
        f"Saved -> {parquet_path}"
    )

    logger.info(
        f"Saved -> {report_path}"
    )


# ============================================================
# MAIN
# ============================================================

def main():

    params = load_params()

    source = params[
        "data_ingestion"
    ]["source"]

    output_dir = params[
        "data_ingestion"
    ]["output_dir"]

    df = load_data(source)

    df = validate_columns(df)

    df = fix_mojibake(df)

    df = clean_types(df)

    df = remove_invalid(df)

    df = deduplicate(df)

    logger.info(
        f"Final Shape: {df.shape}"
    )

    save_outputs(
        df,
        output_dir
    )

    logger.info(
        "Data ingestion completed successfully."
    )


if __name__ == "__main__":
    main()
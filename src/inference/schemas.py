from typing import List

from pydantic import BaseModel


# =====================================================
# SINGLE PREDICTION
# =====================================================

class PredictionRequest(
    BaseModel
):

    text: str


class PredictionResponse(
    BaseModel
):

    sentiment: str

    confidence: float


# =====================================================
# BATCH PREDICTION
# =====================================================

class BatchPredictionRequest(
    BaseModel
):

    texts: List[str]


class BatchPredictionResponse(
    BaseModel
):

    predictions: List[dict]
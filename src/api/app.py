import logging

from fastapi import (
    FastAPI,
    HTTPException
)

from src.inference.predictor import (
    SentimentPredictor
)

from src.inference.schemas import (

    PredictionRequest,

    PredictionResponse,

    BatchPredictionRequest,

    BatchPredictionResponse
)

from fastapi.middleware.cors import CORSMiddleware



# =====================================================
# LOGGING
# =====================================================

logging.basicConfig(

    level=logging.INFO,

    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)

# =====================================================
# APP
# =====================================================

app = FastAPI(

    title="YT Comment Analyzer API",

    version="1.0.0",

    description=
    "Transformer-based YouTube Sentiment Analysis"
)
app.add_middleware(
    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"]
)
# =====================================================
# LOAD MODEL ON STARTUP
# =====================================================

logger.info(
    "Loading predictor..."
)

predictor = SentimentPredictor()

logger.info(
    "Predictor Loaded"
)

# =====================================================
# ROOT
# =====================================================

@app.get("/")
def root():

    return {

        "message":
        "YT Comment Analyzer API",

        "status":
        "running"
    }

# =====================================================
# HEALTH
# =====================================================

@app.get("/health")
def health():

    return {

        "status":
        "healthy",

        "model":
        "loaded"
    }

# =====================================================
# SINGLE PREDICT
# =====================================================

@app.post(

    "/predict",

    response_model=
    PredictionResponse
)

def predict(

    request:
    PredictionRequest
):

    try:

        result = predictor.predict(

            request.text
        )

        return result

    except Exception as e:

        logger.exception(
            "Prediction Failed"
        )

        raise HTTPException(

            status_code=500,

            detail=str(e)
        )

# =====================================================
# BATCH PREDICT
# =====================================================

@app.post(

    "/predict_batch",

    response_model=
    BatchPredictionResponse
)

def predict_batch(

    request:
    BatchPredictionRequest
):

    try:

        results = (

            predictor.predict_batch(

                request.texts
            )
        )

        return {

            "predictions":
            results
        }

    except Exception as e:

        logger.exception(
            "Batch Prediction Failed"
        )

        raise HTTPException(

            status_code=500,

            detail=str(e)
        )

# =====================================================
# MODEL INFO
# =====================================================

@app.get("/model_info")
def model_info():

    return {

        "model_name":
        predictor.config[
            "model_name"
        ],

        "device":
        predictor.device,

        "classes":
        predictor.label_encoder
        .classes_
        .tolist()
    }
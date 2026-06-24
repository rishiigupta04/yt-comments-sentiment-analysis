import torch

from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification
)

MODEL_PATH = (
    "artifacts/deployment_model"
)

DEVICE = (

    "cuda"

    if torch.cuda.is_available()

    else "cpu"
)

tokenizer = (
    AutoTokenizer
    .from_pretrained(
        MODEL_PATH
    )
)

model = (
    AutoModelForSequenceClassification
    .from_pretrained(
        MODEL_PATH
    )
)

model.to(
    DEVICE
)

model.eval()

LABELS = [

    "negative",

    "neutral",

    "positive"
]


@torch.no_grad()
def predict(text):

    encoded = tokenizer(

        text,

        truncation=True,

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

    pred = torch.argmax(

        probs,

        dim=1
    ).item()

    conf = probs.max().item()

    return {

        "sentiment":
            LABELS[pred],

        "confidence":
            round(conf, 4)
    }
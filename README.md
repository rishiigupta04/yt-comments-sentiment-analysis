# 🎬 YouTube Comments Sentiment Analyzer

<div align="center">

### Fine-Tuning Twitter-RoBERTa on 1M+ YouTube Comments for Real-World Sentiment Analysis

![Python](https://img.shields.io/badge/Python-3.11-blue)
![PyTorch](https://img.shields.io/badge/PyTorch-2.x-red)
![Transformers](https://img.shields.io/badge/HuggingFace-Transformers-yellow)
![FastAPI](https://img.shields.io/badge/FastAPI-Production-green)
![License](https://img.shields.io/badge/License-MIT-brightgreen)

---

### 🚀 Live Demo

🤗 **Hugging Face Space:** [Coming Soon]

### 🤗 Model Repository

🤗 **Hugging Face Model:** [Coming Soon]

### 📖 API Documentation

📄 **Swagger Docs:** [Coming Soon]

---

## 🎯 Real-World Performance

| Metric | Score |
|----------|----------|
| Accuracy | **88.00%** |
| Macro F1 | **87.68%** |
| Weighted F1 | **87.73%** |

Evaluated on a manually curated benchmark of realistic YouTube comments containing emojis, slang, creator terminology, and internet culture references.

</div>

---

# 📌 Problem Statement

Traditional sentiment analysis models often struggle with:

- Internet slang
- Emoji-heavy comments
- Short-form reactions
- Creator-specific terminology
- YouTube culture references
- Informal language

Examples:

```text
W video bro 🔥
Absolute cinema
Bro cooked 💀
Nah this ain't it
```

These expressions are common on YouTube but often poorly handled by traditional NLP pipelines.

This project adapts a social-media-aware transformer to the YouTube ecosystem through large-scale fine-tuning and deployment.

---

# 🧠 Why This Project?

Most sentiment projects stop after training a model.

This project was built as an end-to-end Data Science + MLOps system covering:

- Data preprocessing
- Feature engineering
- Traditional ML
- Hyperparameter optimization
- Transformer fine-tuning
- Evaluation
- External validation
- API development
- Model deployment
- Production inference

---

# 🏗️ Project Architecture

```text
YouTube Comments
        ↓
Data Cleaning
        ↓
Transformer Preprocessing
        ↓
Twitter-RoBERTa Backbone
        ↓
Fine-Tuning on YouTube Dataset
        ↓
Evaluation
        ↓
External Validation
        ↓
FastAPI API
        ↓
Hugging Face Spaces
        ↓
Chrome Extension
```

---

# 📊 Project Pipeline

![Pipeline](./pipeline.png)

---

# 📁 Dataset

## Dataset Overview

Large-scale YouTube comments sentiment dataset.

### Size

```text
1,000,000+ Comments
```

### Classes

```text
Positive
Neutral
Negative
```

### Split

| Dataset | Percentage |
|----------|----------|
| Train | 80% |
| Validation | 10% |
| Test | 10% |

---

# 🧪 Model Evolution & Decision-Making Journey

## Why Not Start With Transformers?

Instead of immediately jumping to deep learning, the project followed a traditional machine learning workflow first.

This helped answer:

> Can simpler models solve the problem effectively before introducing the complexity of transformers?

Benefits:

- Faster experimentation
- Strong baselines
- Better dataset understanding
- Quantifiable transformer improvements

---

## Phase 1 — Baseline Model

### Bag of Words + Random Forest

Pipeline:

```text
Bag of Words
      +
Random Forest
```

### Why?

- Quick baseline
- Easy interpretation
- Fast experimentation

### Result

```text
Accuracy ≈ 65%
```

### Observations

Struggled with:

- Emojis
- Slang
- Context
- Negation
- Short comments

Example:

```text
W video bro 🔥
```

The model could not understand that this represents positive sentiment.

### Conclusion

Keyword counting alone was insufficient.

---

## Phase 2 — Feature Engineering

### TF-IDF + N-Grams

Experiments:

- TF-IDF
- TF-IDF + Bigrams
- TF-IDF + Trigrams
- Vocabulary optimization

### Why?

TF-IDF captures informative words better than raw counts.

N-grams help learn phrases such as:

```text
not good
highly recommend
w video
```

### Result

```text
Accuracy ≈ 75%
```

### Key Learning

Feature representation mattered more than model complexity.

---

## Phase 3 — Gradient Boosting

### TF-IDF + LightGBM

Pipeline:

```text
TF-IDF
      +
LightGBM
```

### Why LightGBM?

Compared to Random Forest:

- Better with sparse data
- Faster
- Stronger generalization
- Better scalability

### Result

```text
Accuracy ≈ 86%
```

### Key Insight

Traditional NLP + Gradient Boosting was surprisingly competitive.

---

## Phase 4 — Hyperparameter Optimization

### LightGBM + Optuna

Parameters optimized:

- Learning Rate
- Max Depth
- Num Leaves
- Feature Count
- N-Gram Range
- Regularization

### Result

```text
Validation Macro F1 ≈ 0.91
```

### Important Discovery

A data leakage issue was identified and fixed during experimentation.

This reinforced the importance of:

- Proper train-test separation
- Reliable evaluation pipelines
- Validation discipline

---

## Why Move Beyond LightGBM?

Despite strong validation performance, limitations remained.

### Context Understanding

Example:

```text
I thought this would be terrible but it was amazing
```

TF-IDF cannot fully understand relationships between words.

---

### Social Media Language

Examples:

```text
Bro cooked 🔥

Absolute cinema

W video

Nah this ain't it
```

These require semantic understanding rather than keyword matching.

---

### Semantic Similarity

Traditional NLP struggles to understand that:

```text
Amazing
Fantastic
Incredible
```

express similar sentiment.

Transformers naturally learn these relationships.

---

## Phase 5 — Transformer Fine-Tuning

### Selected Backbone

```text
cardiffnlp/twitter-roberta-base-sentiment-latest
```

---

## Why Twitter-RoBERTa?

Twitter/X and YouTube comments share:

- Emojis
- Slang
- Informal language
- Social media culture
- Short text

The model already possessed strong social-media language understanding.

---

## Transfer Learning Strategy

```text
Twitter/X Data
        ↓
Twitter-RoBERTa
        ↓
Fine-Tuning on 1M+ YouTube Comments
        ↓
YouTube-Specific Sentiment Model
```

---

## Training Enhancements

Implemented:

- Mixed Precision Training (AMP)
- Layer-wise Learning Rate Decay (LLRD)
- Gradient Accumulation
- Cosine LR Scheduler
- Warmup Scheduling
- Gradient Checkpointing
- Class Weighted Loss
- Early Stopping
- Best Checkpoint Saving
- Resume Training Support

---

# 🎯 Sentiment Classes

| Label | Meaning |
|---------|---------|
| 🔴 Negative | Criticism, dislike, frustration |
| ⚪ Neutral | Informational or objective |
| 🟢 Positive | Praise, excitement, appreciation |

---

# 📈 Evaluation Results

## Real-World External Validation Benchmark

A manually curated benchmark containing:

- Internet slang
- Emojis
- Creator terminology
- Viral phrases
- Mixed sentiment
- Realistic YouTube comments

### Results

| Metric | Score |
|----------|----------|
| Accuracy | **88.00%** |
| Macro F1 | **87.68%** |
| Weighted F1 | **87.73%** |

---

## Internal Test Set

| Metric | Score |
|----------|----------|
| Accuracy | 77.43% |
| Macro F1 | 77.38% |
| Weighted F1 | 77.41% |

The external benchmark is considered a more realistic estimate of deployment performance.

---


# 📊 Normalized Confusion Matrix

The model performs consistently across all sentiment classes.

Most errors occur between Neutral and Positive classes.

Negative sentiment is generally detected more reliably.

![Normalized Confusion Matrix](artifacts/evaluation/normalized_confusion_matrix.png)

---

# 🔥 Example Predictions

### Example 1

Input:

```text
W video bro 🔥
```

Prediction:

```text
Positive
Confidence: 99.7%
```

---

### Example 2

Input:

```text
Absolute cinema
```

Prediction:

```text
Positive
```

---

### Example 3

Input:

```text
nah this ain't it
```

Prediction:

```text
Negative
```

---

### Example 4

Input:

```text
Worst update ever
```

Prediction:

```text
Negative
```

---

### Example 5

Input:

```text
Uploaded 2 hours ago
```

Prediction:

```text
Neutral
```

---

# 🚀 Deployment Architecture

```text
YouTube Comment
        ↓
Chrome Extension
        ↓
FastAPI API
        ↓
Hugging Face Spaces
        ↓
Fine-Tuned RoBERTa
        ↓
Sentiment + Confidence
```

---

# 📖 API Example

## Request

```http
POST /predict
```

```json
{
  "text": "Absolute cinema 🔥"
}
```

## Response

```json
{
  "sentiment": "positive",
  "confidence": 0.997
}
```

---

# 🛠️ Tech Stack

## NLP

- Hugging Face Transformers
- RoBERTa
- Tokenizers

## Machine Learning

- PyTorch
- Scikit-Learn
- LightGBM
- Optuna

## Data Processing

- Pandas
- NumPy

## MLOps

- DVC
- FastAPI
- Hugging Face Hub
- Hugging Face Spaces

## Deployment

- Docker
- FastAPI
- Hugging Face

---

# 📂 Repository Structure

```text
src/
├── data/
├── features/
├── model/
├── evaluation/
├── inference/
├── api/
└── deployment/

artifacts/
├── models/
├── features/
└── deployment_model/

data/
```

---

# 📚 Key Learnings

- Data leakage can dramatically inflate performance.
- Validation scores do not always reflect real-world performance.
- External validation is critical.
- Feature engineering remains valuable even in the transformer era.
- Transfer learning drastically reduces training costs.
- Deployment and monitoring are as important as modeling.

---

# 🔮 Future Improvements

- Multilingual sentiment analysis
- Aspect-based sentiment analysis
- Sarcasm detection
- Quantized deployment
- Real-time dashboard
- Analytics platform for creators

---

# 🔗 Links

- 🤗 Hugging Face Model: [Add Link]
- 🚀 Hugging Face Space: [Add Link]
- 💼 LinkedIn: [Add Link]

---

# 👨‍💻 Author

## Rishiraj Gupta

M.Sc. Data Science

This project demonstrates:

✅ End-to-End NLP Pipeline

✅ Transformer Fine-Tuning

✅ Traditional ML Benchmarking

✅ Hyperparameter Optimization

✅ Evaluation & Error Analysis

✅ MLOps Practices

✅ FastAPI Deployment

✅ Hugging Face Deployment

✅ Production Inference APIs

---

<div align="center">

### ⭐ If you found this project interesting, consider giving it a star.

Built with ❤️ using PyTorch, Transformers and FastAPI.

</div>

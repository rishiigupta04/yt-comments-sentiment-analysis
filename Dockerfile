FROM python:3.11

WORKDIR /app

COPY . .

RUN pip install -r requirements.txt

CMD ["uvicorn","src.api.app:app","--host","0.0.0.0","--port","7860"]
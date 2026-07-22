FROM python:3.12-slim

WORKDIR /app

# chromadb / onnxruntime need libgomp1 on Debian; curl is needed for HEALTHCHECK.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Separate layer so `pip install` is only re-run when requirements.txt changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Data/db dirs are created (and owned by `app`) before the volumes mount over
# them, so Docker seeds the named volumes with the right ownership on first run.
RUN useradd --create-home --shell /bin/bash app \
    && mkdir -p /app/data /app/db_data \
    && chown -R app:app /app

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}

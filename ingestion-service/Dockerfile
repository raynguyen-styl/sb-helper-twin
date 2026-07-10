# ingestion-service — two entrypoints from one image (on the platform `backend` network; the shared
# ClickHouse is internal-only):
#   • build_feb_clickhouse.py — one-shot bulk builder (compose `ch-ingest`, profile ingest); reads the
#     Feb parquets + taxonomy.py bind-mounted at /data/analysis.
#   • app.py (FastAPI, uvicorn) — the HTTP ingest service behind the dashboard's Upload tab (compose
#     `smartbuddy-ingest`, overrides CMD).
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY build_feb_clickhouse.py app.py ./
# default CMD = the one-shot builder; the HTTP service overrides it in docker-compose.agent.yml
CMD ["python", "build_feb_clickhouse.py"]

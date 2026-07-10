# ingestion-service — one image, three entrypoints (runs on the platform `backend` network; the
# shared ClickHouse is internal-only):
#   • init_db.py        — one-shot ADMIN bootstrap: create db + insights table + ro/rw users (no data).
#   • app.py (uvicorn)  — the chunked, resumable, size-unlimited HTTP upload service behind the
#                         dashboard's "Upload data" tab (long-running; the default CMD).
#   • build_insights.py — one-shot: (re)build a month's precomputed insight bundles into `insights`.
# The loader ingest_core.py + vendored taxonomy.py / *_geo.json are shared by all three.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# default = the long-running upload service; init_db.py / build_insights.py run via compose one-shots.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8200"]

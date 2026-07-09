# SMART Buddy ingestion — one-shot backfill: feb_data CSVs -> InfluxDB history + Ditto twins.
# Mirrors tree-digital-twin/ingestion. Mount feb_data + analysis read-only at run time.
FROM python:3.12-slim
WORKDIR /app
ENV PIP_NO_CACHE_DIR=1
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY sb_backfill.py ./
# Inputs are mounted (see docker-compose.sb.yml) and located via SB_FEB_DIR / SB_SCHOOL_GEO /
# SB_ANALYSIS_DIR. --write pushes to the stores; drop --write for a dry-run.
CMD ["python", "sb_backfill.py", "--write"]

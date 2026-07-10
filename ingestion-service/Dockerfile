# One-shot builder: Feb parquets -> shared ClickHouse `smartbuddy` database.
# Runs on the platform `backend` network (the shared ClickHouse is internal-only). The Feb
# parquets + taxonomy.py are bind-mounted at /data/analysis (see docker-compose.agent.yml).
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY build_feb_clickhouse.py .
CMD ["python", "build_feb_clickhouse.py"]

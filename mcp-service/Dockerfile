# The MCP holds no data — it queries the shared ClickHouse over HTTP via @clickhouse/client
# (pure JS, no native binding). It connects as the read-only `smartbuddy_ro` user; connection
# details come from the environment (see docker-compose.agent.yml / .env.example).
FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
EXPOSE 3501
CMD ["node", "--max-old-space-size=512", "src/index.js"]

# node:24-slim (Debian/glibc), NOT alpine — the @duckdb/node-api native binding
# ships glibc prebuilts; musl (alpine) would fail to load. The Feb DuckDB file is
# NOT baked in (real IDs + large); it is bind-mounted read-only at /app/data.
FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
ENV FEB_DUCKDB_PATH=/app/data/feb.duckdb
EXPOSE 3501
CMD ["node", "--max-old-space-size=512", "src/index.js"]

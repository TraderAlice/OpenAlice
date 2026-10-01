FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GATEWAY_DB_PATH=/data/gateway.db \
    GATEWAY_HOST=0.0.0.0 \
    GATEWAY_PORT=8787

COPY pyproject.toml README.md ./
COPY src ./src

RUN pip install --no-cache-dir . \
    && mkdir -p /data

VOLUME ["/data"]
EXPOSE 8787

CMD ["python", "-m", "market_data_gateway"]

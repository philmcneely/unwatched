# The coordinator hub — v1. Stdlib Python only; no dependencies.
FROM python:3.12-alpine
WORKDIR /app
COPY hub.py .
ENV HUB_PORT=4600 HUB_DB=/data/hub.db
EXPOSE 4600
VOLUME ["/data"]
CMD ["python3", "hub.py"]

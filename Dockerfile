FROM docker.m.daocloud.io/library/python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LOOPER_DB=/app/data/guides.sqlite3 OMP_THREAD_LIMIT=2
RUN sed -i 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
    && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir --index-url https://mirrors.aliyun.com/pypi/simple Pillow==12.3.0
WORKDIR /app
COPY server.py ./
COPY looper ./looper
COPY static ./static
RUN mkdir /app/data && chown -R 1000:1000 /app
USER 1000:1000
EXPOSE 8080
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8080"]

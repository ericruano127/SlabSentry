FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN groupadd -r vision && useradd -r -g vision -d /srv vision && chown -R vision:vision /srv
USER vision
# Processes × threads should match the machine's vCPUs (2 vCPU: 2 workers × 1 OpenCV thread).
ENV PORT=8001 VISION_WORKERS=2 VISION_THREADS=1
EXPOSE 8001
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers ${VISION_WORKERS}"]

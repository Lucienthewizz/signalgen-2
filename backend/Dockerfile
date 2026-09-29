FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

COPY backend/requirements.txt /workspace/backend/requirements.txt
RUN pip install --no-cache-dir -r /workspace/backend/requirements.txt

COPY backend/app /workspace/backend/app
COPY frontend/desktop/renderer /workspace/frontend/desktop/renderer

WORKDIR /workspace/backend


FROM base AS runtime

EXPOSE 3456 8765

CMD ["python", "-m", "app.docker_server"]


FROM base AS test

COPY backend/pytest.ini /workspace/backend/pytest.ini
COPY backend/tests /workspace/backend/tests

CMD ["python", "-m", "pytest"]

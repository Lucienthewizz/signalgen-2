FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

COPY legacy/python/requirements.txt /workspace/legacy/python/requirements.txt
RUN pip install --no-cache-dir -r /workspace/legacy/python/requirements.txt

COPY legacy/python/app /workspace/legacy/python/app
COPY legacy/desktop/renderer /workspace/legacy/desktop/renderer

WORKDIR /workspace/legacy/python


FROM base AS runtime

EXPOSE 3456 8765

CMD ["python", "-m", "app.docker_server"]


FROM base AS test

COPY legacy/python/pytest.ini /workspace/legacy/python/pytest.ini
COPY legacy/python/tests /workspace/legacy/python/tests

CMD ["python", "-m", "pytest"]

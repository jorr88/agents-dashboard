FROM python:3.12-slim

WORKDIR /app

# Install openclaw CLI (Node.js based) and Python deps
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install latest openclaw
RUN npm install -g openclaw@latest 2>/dev/null || echo "openclaw npm install skipped (will rely on host mount)"

COPY . .

RUN mkdir -p /app/data

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

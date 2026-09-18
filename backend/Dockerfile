# ---- Stage 1: Build the widget JS bundle ----
FROM node:20-alpine AS widget-builder
WORKDIR /widget
COPY widget/package.json ./
RUN npm install
COPY widget/ ./
RUN mkdir -p /out && node -e "require('esbuild').buildSync({entryPoints:['src/index.js'],bundle:true,minify:true,outfile:'/out/widget.js'})"

# ---- Stage 2: Python backend ----
FROM python:3.12-slim
WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*

# Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source
COPY backend/ .

# Built widget
RUN mkdir -p static
COPY --from=widget-builder /out/widget.js static/widget.js

RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]

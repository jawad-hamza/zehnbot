# ---- Stage 1: Build the widget JS bundle ----
FROM node:22-alpine AS widget-builder
WORKDIR /widget
COPY widget/package.json widget/package-lock.json ./
# only the bundler; the test tooling (jsdom) is not needed to build
RUN npm ci --omit=dev
COPY widget/ ./
RUN mkdir -p /out && node -e "require('esbuild').buildSync({entryPoints:['src/index.js'],bundle:true,minify:true,outfile:'/out/widget.js'})"

# ---- Stage 2: Python backend ----
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

# Python deps (all ship as wheels, so no compiler is needed in the image)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source
COPY backend/ .

# Built widget
RUN mkdir -p static
COPY --from=widget-builder /out/widget.js static/widget.js

# Run as an unprivileged user
RUN chmod +x entrypoint.sh && useradd --system --no-create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
# --start-interval: check every 3s while starting, so a deploy learns quickly that the API is up
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --start-interval=3s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=4).status == 200 else 1)"

CMD ["./entrypoint.sh"]

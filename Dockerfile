# ---- Stage 1: build the Vite frontend ----
FROM node:22-alpine AS webbuild
WORKDIR /app/web
ARG GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
# vite.config.js outDir '../public' -> writes to /app/public

# ---- Stage 2: slim runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY index.js ./
COPY src ./src
COPY scripts ./scripts
COPY --from=webbuild /app/public ./public
EXPOSE 4000
CMD ["node", "index.js"]

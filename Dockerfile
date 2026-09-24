FROM node:22-alpine AS webapp
WORKDIR /build
COPY webapp/package.json webapp/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY webapp/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    TZ=Asia/Irkutsk \
    NODE_EXTRA_CA_CERTS=/app/certs/russian_trusted_root_ca.pem
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
COPY certs ./certs
COPY --from=webapp /build/dist ./webapp/dist
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["sh", "scripts/docker-start.sh"]

FROM n8nio/n8n:2.42.7 AS n8n-source

FROM node:24-bookworm-slim

# Install system dependencies: PostgreSQL 15, Redis server, OpenSSL, curl, procps, build tools, and dumb-init
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    postgresql-15 \
    postgresql-contrib-15 \
    redis-server \
    curl \
    procps \
    dumb-init \
    bash \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy n8n pre-built bundle from official n8n v2 image (pinned to verified stable release 2.42.7)
COPY --from=n8n-source /usr/local/lib/node_modules/n8n /usr/local/lib/node_modules/n8n
RUN ln -s /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n

# Rebuild isolated-vm native module against Debian glibc to guarantee ABI compatibility
RUN cd /usr/local/lib/node_modules/n8n/node_modules/.pnpm/isolated-vm@7.0.1/node_modules/isolated-vm && npm run install

WORKDIR /app

COPY package*.json ./
RUN sed -i 's|https://registry.npmmirror.com/|https://registry.npmjs.org/|g' package-lock.json \
    && npm config set registry https://registry.npmjs.org/ \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 10000 \
    && npm install

COPY . .

RUN npx prisma generate
RUN npm run build

RUN chmod +x ./entrypoint.sh

# Only public web service ports are exposed
EXPOSE 3000
EXPOSE 80

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./entrypoint.sh"]

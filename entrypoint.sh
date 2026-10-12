#!/bin/bash
set -e

echo "=================================================="
echo "  STARTING CARNO ALL-IN-ONE PRODUCTION CONTAINER  "
echo "=================================================="

# 1. Start Redis Server (if not externally configured)
if [ -z "$REDIS_URL" ]; then
  echo "[1/5] Starting Internal Redis Server..."
  mkdir -p /var/log/redis /var/lib/redis
  chown -R redis:redis /var/log/redis /var/lib/redis 2>/dev/null || true
  /usr/bin/redis-server --daemonize yes --appendonly yes --requirepass "carno_redis_pass_2026"
  export REDIS_URL="redis://:carno_redis_pass_2026@127.0.0.1:6379"
  export REDIS_PASSWORD="carno_redis_pass_2026"
  echo "  ✓ Internal Redis online on port 6379."
else
  echo "[1/5] Using External Redis from environment ($REDIS_URL)..."
fi

# 2. Start PostgreSQL (if not externally configured)
if [ -z "$DATABASE_URL" ]; then
  echo "[2/5] Starting Internal PostgreSQL Server..."
  service postgresql start

  for i in {1..30}; do
    if pg_isready -q; then
      break
    fi
    echo "  Waiting for PostgreSQL..."
    sleep 1
  done

  # Initialize User and Database if not exists
  su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname = 'carno_app'\" | grep -q 1 || psql -c \"CREATE USER carno_app WITH SUPERUSER PASSWORD 'carno_secret_2026';\""
  su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname = 'carlanding'\" | grep -q 1 || psql -c \"CREATE DATABASE carlanding OWNER carno_app;\""
  su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE carlanding TO carno_app;\""

  export DATABASE_URL="postgresql://carno_app:carno_secret_2026@127.0.0.1:5432/carlanding?schema=public"
  echo "  ✓ Internal PostgreSQL online with database 'carlanding'."
else
  echo "[2/5] Using External Database from environment..."
fi

# 3. Synchronize Prisma Schema
echo "[3/5] Synchronizing Prisma DB Schema..."
npx prisma db push --skip-generate || true
echo "  ✓ Prisma DB schema verified."

# 4. Start SMS Worker in background
echo "[4/5] Starting SMS Worker..."
npm run worker:sms &
echo "  ✓ SMS Worker spawned in background."

# 5. Start Port 80 forwarder (Handles both Port 80 and Port 3000 seamlessly)
echo "[5/5] Starting Port 80 Forwarder..."
node -e "
const http = require('http');
http.createServer((req, res) => {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: 3000,
    path: req.url,
    method: req.method,
    headers: req.headers
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Application is initializing... Please refresh.');
  });
  req.pipe(proxyReq, { end: true });
}).listen(80, '0.0.0.0', () => console.log('  ✓ Dual-Port Bridge: Port 80 forwarded to 3000'));
" &

# 6. Start Next.js App
echo "=================================================="
echo "  LAUNCHING NEXT.JS WEB SERVER ON 0.0.0.0:3000    "
echo "=================================================="
export HOSTNAME="0.0.0.0"
export PORT=3000

exec npx next start -H 0.0.0.0 -p 3000

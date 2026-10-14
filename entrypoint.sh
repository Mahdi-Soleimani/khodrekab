#!/bin/bash
set -e

# ==============================================================================
# CARNO / KHODREKAB.IR — ALL-IN-ONE SECURE PRODUCTION ENTRYPOINT
# ==============================================================================
# Architecture: Single-container running Next.js, PostgreSQL, Redis, n8n, SMS Worker
# Isolation: Internal services bound strictly to 127.0.0.1 (Loopback only)
# Storage: Persistent data stored in $CARNO_DATA_DIR (/var/lib/carno-data)
# ==============================================================================

echo "=================================================="
echo "  STARTING CARNO ALL-IN-ONE SERVICE CONTAINER     "
echo "=================================================="

# ------------------------------------------------------------------------------
# 0. Global Paths & Environment Setup
# ------------------------------------------------------------------------------
CARNO_DATA_DIR="${KHODREKAB_DATA_DIR:-${CARNO_DATA_DIR:-/var/lib/carno-data}}"
PG_DATA_DIR="$CARNO_DATA_DIR/postgres"
REDIS_DATA_DIR="$CARNO_DATA_DIR/redis"
N8N_DATA_DIR="$CARNO_DATA_DIR/n8n"

mkdir -p "$PG_DATA_DIR" "$REDIS_DATA_DIR" "$N8N_DATA_DIR" /var/log/carno

# Internal host aliases for container loopback
if [ -w /etc/hosts ]; then
  echo "127.0.0.1 app db redis n8n" >> /etc/hosts 2>/dev/null || true
fi

# Track child PIDs for graceful shutdown
PG_RUNNING=0
REDIS_RUNNING=0
N8N_PID=""
WORKER_PID=""
BRIDGE_PID=""
NEXT_PID=""

# ------------------------------------------------------------------------------
# Graceful Shutdown Handler (Trap for SIGTERM, SIGINT, SIGQUIT)
# ------------------------------------------------------------------------------
graceful_shutdown() {
  echo ""
  echo "=================================================="
  echo "[SHUTDOWN] Received termination signal. Stopping all services gracefully..."
  echo "=================================================="

  # 1. Stop Next.js Web Server
  if [ -n "$NEXT_PID" ] && kill -0 "$NEXT_PID" 2>/dev/null; then
    echo "[SHUTDOWN] Stopping Next.js (PID $NEXT_PID)..."
    kill -TERM "$NEXT_PID" 2>/dev/null || true
  fi

  # 2. Stop SMS Worker
  if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "[SHUTDOWN] Stopping SMS Worker (PID $WORKER_PID)..."
    kill -TERM "$WORKER_PID" 2>/dev/null || true
  fi

  # 3. Stop n8n
  if [ -n "$N8N_PID" ] && kill -0 "$N8N_PID" 2>/dev/null; then
    echo "[SHUTDOWN] Stopping n8n (PID $N8N_PID)..."
    kill -TERM "$N8N_PID" 2>/dev/null || true
  fi

  # 4. Stop Dual-Port Bridge
  if [ -n "$BRIDGE_PID" ] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
    kill -TERM "$BRIDGE_PID" 2>/dev/null || true
  fi

  # 5. Stop Redis Server
  if [ "$REDIS_RUNNING" -eq 1 ]; then
    echo "[SHUTDOWN] Stopping Redis server cleanly..."
    if [ -n "$RESOLVED_REDIS_PASS" ]; then
      redis-cli -h 127.0.0.1 -p 6379 -a "$RESOLVED_REDIS_PASS" shutdown nosave 2>/dev/null || true
    else
      redis-cli -h 127.0.0.1 -p 6379 shutdown nosave 2>/dev/null || true
    fi
  fi

  # 6. Stop PostgreSQL Server cleanly (fast shutdown flushes WAL and terminates active backends)
  if [ "$PG_RUNNING" -eq 1 ] && [ -n "$PG_BIN" ]; then
    echo "[SHUTDOWN] Stopping PostgreSQL cleanly..."
    su - postgres -c "$PG_BIN/pg_ctl -D '$PG_DATA_DIR' -m fast -w stop" 2>/dev/null || service postgresql stop 2>/dev/null || true
  fi

  echo "[SHUTDOWN] All services terminated. Graceful shutdown complete."
  exit 0
}

trap graceful_shutdown SIGTERM SIGINT SIGQUIT

# ------------------------------------------------------------------------------
# 1. Redis Server (Persistent & Loopback Authenticated)
# ------------------------------------------------------------------------------
echo "[1/6] Configuring & Starting Internal Redis Server..."

# Ensure ownership and restrictive permissions on persistent redis dir
chown -R redis:redis "$REDIS_DATA_DIR" 2>/dev/null || chown -R 1000:1000 "$REDIS_DATA_DIR" 2>/dev/null || true
chmod 750 "$REDIS_DATA_DIR"

# Resolve Redis Password securely (Env > Secret File > Persistent Disk File)
if [ -n "$REDIS_PASSWORD" ]; then
  RESOLVED_REDIS_PASS="$REDIS_PASSWORD"
elif [ -n "$REDIS_PASSWORD_FILE" ] && [ -s "$REDIS_PASSWORD_FILE" ]; then
  RESOLVED_REDIS_PASS=$(cat "$REDIS_PASSWORD_FILE" | tr -d '\r\n')
elif [ -s "/run/secrets/redis_password" ]; then
  RESOLVED_REDIS_PASS=$(cat "/run/secrets/redis_password" | tr -d '\r\n')
elif [ -s "secrets/redis_password.txt" ]; then
  RESOLVED_REDIS_PASS=$(cat "secrets/redis_password.txt" | tr -d '\r\n')
else
  # Use a persistent password file on the mounted disk so restarts don't lose password
  if [ ! -s "$REDIS_DATA_DIR/redis_password.txt" ]; then
    openssl rand -hex 24 > "$REDIS_DATA_DIR/redis_password.txt"
    chmod 600 "$REDIS_DATA_DIR/redis_password.txt"
  fi
  RESOLVED_REDIS_PASS=$(cat "$REDIS_DATA_DIR/redis_password.txt" | tr -d '\r\n')
fi

# Launch Redis bound strictly to 127.0.0.1
/usr/bin/redis-server \
  --daemonize yes \
  --bind 127.0.0.1 \
  --protected-mode yes \
  --port 6379 \
  --dir "$REDIS_DATA_DIR" \
  --appendonly yes \
  --appendfsync everysec \
  --maxmemory 256mb \
  --maxmemory-policy noeviction \
  --requirepass "$RESOLVED_REDIS_PASS"

# Verify Redis readiness
REDIS_READY=0
for i in {1..30}; do
  if [ "$(redis-cli -h 127.0.0.1 -p 6379 -a "$RESOLVED_REDIS_PASS" ping 2>/dev/null)" = "PONG" ]; then
    REDIS_READY=1
    break
  fi
  sleep 1
done

if [ "$REDIS_READY" -ne 1 ]; then
  echo "  ✗ [FATAL] Redis failed to start or authenticate on 127.0.0.1:6379" >&2
  exit 1
fi

REDIS_RUNNING=1
export REDIS_URL="redis://127.0.0.1:6379"
export REDIS_PASSWORD="$RESOLVED_REDIS_PASS"
echo "  ✓ Internal Redis online on 127.0.0.1:6379 (authenticated, storage: $REDIS_DATA_DIR)"

# ------------------------------------------------------------------------------
# 2. PostgreSQL Server (Persistent, Least-Privilege & Loopback Only)
# ------------------------------------------------------------------------------
echo "[2/6] Configuring & Starting Internal PostgreSQL Server..."

# Discover PostgreSQL binary directory dynamically (Debian multi-version support)
PG_BIN=$(find /usr/lib/postgresql/ -name initdb -exec dirname {} \; 2>/dev/null | head -n 1)
if [ -z "$PG_BIN" ]; then
  PG_BIN="$(dirname "$(which initdb 2>/dev/null || echo '/usr/lib/postgresql/15/bin/initdb')")"
fi
export PATH="$PG_BIN:$PATH"

chown -R postgres:postgres "$PG_DATA_DIR"
chmod 700 "$PG_DATA_DIR"

# Safe Data Initialization:
# Never blindly copy raw running directory files. Only init fresh cluster if PG_VERSION is absent.
if [ ! -f "$PG_DATA_DIR/PG_VERSION" ]; then
  echo "  [DB_INIT] Initializing fresh PostgreSQL cluster in $PG_DATA_DIR..."
  su - postgres -c "$PG_BIN/initdb -D '$PG_DATA_DIR' --encoding=UTF8 --locale=C.UTF-8"
  NEW_CLUSTER_INITIALIZED=1
else
  echo "  [DB_START] Existing PostgreSQL cluster detected in $PG_DATA_DIR (retaining data)."
  NEW_CLUSTER_INITIALIZED=0
fi

# Clean any stale postmaster.pid from an abrupt container kill
if [ -f "$PG_DATA_DIR/postmaster.pid" ]; then
  # Only remove if the process inside postmaster.pid is not running
  PID_VAL=$(head -n 1 "$PG_DATA_DIR/postmaster.pid" 2>/dev/null || true)
  if [ -n "$PID_VAL" ] && ! kill -0 "$PID_VAL" 2>/dev/null; then
    rm -f "$PG_DATA_DIR/postmaster.pid"
  fi
fi

# Enforce secure loopback configuration in postgresql.conf
sed -i "/^listen_addresses/d" "$PG_DATA_DIR/postgresql.conf" 2>/dev/null || true
sed -i "/^port/d" "$PG_DATA_DIR/postgresql.conf" 2>/dev/null || true
cat << EOF >> "$PG_DATA_DIR/postgresql.conf"
listen_addresses = '127.0.0.1'
port = 5432
max_connections = 50
shared_buffers = 128MB
EOF

# Enforce strict loopback authentication in pg_hba.conf
cat << 'EOF' > "$PG_DATA_DIR/pg_hba.conf"
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                peer
local   all             all                                     md5
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
EOF
chown postgres:postgres "$PG_DATA_DIR/pg_hba.conf" "$PG_DATA_DIR/postgresql.conf"

# Start PostgreSQL using pg_ctl
su - postgres -c "$PG_BIN/pg_ctl -D '$PG_DATA_DIR' -l '$PG_DATA_DIR/postgresql.log' -w start"

PG_READY=0
for i in {1..30}; do
  if pg_isready -h 127.0.0.1 -p 5432 -q; then
    PG_READY=1
    break
  fi
  sleep 1
done

if [ "$PG_READY" -ne 1 ]; then
  echo "  ✗ [FATAL] PostgreSQL failed to accept connections on 127.0.0.1:5432" >&2
  exit 1
fi

PG_RUNNING=1

# Resolve database passwords securely (KHODREKAB_* primary, CARNO_* legacy fallback)
CARNO_APP_PASS="${KHODREKAB_APP_DB_PASSWORD:-${CARNO_APP_DB_PASSWORD:-carno_app_pass_secure_2026}}"
CARNO_MIGRATOR_PASS="${KHODREKAB_MIGRATOR_DB_PASSWORD:-${CARNO_MIGRATOR_DB_PASSWORD:-carno_migrator_pass_secure_2026}}"

# Ensure database 'carlanding' exists
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname = 'carlanding'\" | grep -q 1 || psql -c \"CREATE DATABASE carlanding;\""

# Ensure least-privilege roles exist and set/update their passwords
su - postgres -c "psql -c \"
DO \\\$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'carno_migrator') THEN
    CREATE ROLE carno_migrator WITH LOGIN PASSWORD '$CARNO_MIGRATOR_PASS';
  ELSE
    ALTER ROLE carno_migrator WITH PASSWORD '$CARNO_MIGRATOR_PASS';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'carno_app') THEN
    CREATE ROLE carno_app WITH LOGIN PASSWORD '$CARNO_APP_PASS';
  ELSE
    ALTER ROLE carno_app WITH PASSWORD '$CARNO_APP_PASS';
  END IF;
END \\\$\$;
\""

# Bootstrap roles, schemas, and default privileges
su - postgres -c "psql -d carlanding -c \"
GRANT ALL ON DATABASE carlanding TO carno_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO carno_migrator;
ALTER SCHEMA public OWNER TO carno_migrator;

GRANT CONNECT ON DATABASE carlanding TO carno_app;
GRANT USAGE ON SCHEMA public TO carno_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM carno_app;

ALTER DEFAULT PRIVILEGES FOR ROLE carno_migrator IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO carno_app;

ALTER DEFAULT PRIVILEGES FOR ROLE carno_migrator IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO carno_app;
\""

# Check if an explicit offline SQL restore was provided on a fresh cluster
RESTORE_FILE=""
if [ "$NEW_CLUSTER_INITIALIZED" -eq 1 ]; then
  if [ -n "$CARNO_INITIAL_SQL_RESTORE" ] && [ -f "$CARNO_INITIAL_SQL_RESTORE" ]; then
    RESTORE_FILE="$CARNO_INITIAL_SQL_RESTORE"
  elif [ -f "$CARNO_DATA_DIR/initial_restore.sql" ]; then
    RESTORE_FILE="$CARNO_DATA_DIR/initial_restore.sql"
  fi

  if [ -n "$RESTORE_FILE" ]; then
    echo "  [DATA_RESTORATION] Restoring verified offline backup from $RESTORE_FILE..."
    su - postgres -c "psql -d carlanding -f '$RESTORE_FILE'" || echo "  [WARNING] Initial SQL restore encountered warnings."
  fi
fi

# Set URLs for migrations and application
MIGRATION_DATABASE_URL="postgresql://carno_migrator:${CARNO_MIGRATOR_PASS}@127.0.0.1:5432/carlanding?schema=public"
export DATABASE_URL="postgresql://carno_app:${CARNO_APP_PASS}@127.0.0.1:5432/carlanding?schema=public&connection_limit=15&pool_timeout=10&connect_timeout=5"

echo "  ✓ Internal PostgreSQL online on 127.0.0.1:5432 (database: carlanding, storage: $PG_DATA_DIR)"

# ------------------------------------------------------------------------------
# 3. Prisma Migrations (Production-Safe & Idempotent)
# ------------------------------------------------------------------------------
echo "[3/6] Applying Prisma Migrations via carno_migrator..."
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy

# Ensure carno_app has DML privileges on all existing public tables & sequences
su - postgres -c "psql -d carlanding -c \"
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO carno_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO carno_app;
\""
echo "  ✓ Prisma DB migrations verified and applied."

# ------------------------------------------------------------------------------
# 4. n8n Workflow Automation (Internal Loopback Only)
# ------------------------------------------------------------------------------
echo "[4/6] Checking n8n Workflow Engine..."
if command -v n8n >/dev/null 2>&1 && [ "$ENABLE_N8N" != "false" ]; then
  chown -R 1000:1000 "$N8N_DATA_DIR" 2>/dev/null || true
  chmod 750 "$N8N_DATA_DIR"

  # Ensure stable n8n encryption key persists across container replacement
  if [ -n "$N8N_ENCRYPTION_KEY" ]; then
    RESOLVED_N8N_KEY="$N8N_ENCRYPTION_KEY"
  elif [ -s "$N8N_DATA_DIR/n8n_encryption_key.txt" ]; then
    RESOLVED_N8N_KEY=$(cat "$N8N_DATA_DIR/n8n_encryption_key.txt" | tr -d '\r\n')
  else
    RESOLVED_N8N_KEY=$(openssl rand -hex 24)
    echo "$RESOLVED_N8N_KEY" > "$N8N_DATA_DIR/n8n_encryption_key.txt"
    chmod 600 "$N8N_DATA_DIR/n8n_encryption_key.txt"
  fi

  # Ensure PostgreSQL n8n schema exists and permissions are granted
  su - postgres -c "psql -d ${POSTGRES_DB:-carlanding} -c \"CREATE SCHEMA IF NOT EXISTS n8n AUTHORIZATION carno_migrator; GRANT ALL ON SCHEMA n8n TO carno_migrator; GRANT ALL ON DATABASE ${POSTGRES_DB:-carlanding} TO carno_migrator; GRANT USAGE ON SCHEMA n8n TO carno_app;\"" >/dev/null 2>&1 || true

  export DB_TYPE=postgresdb
  export DB_POSTGRESDB_HOST=127.0.0.1
  export DB_POSTGRESDB_PORT=5432
  export DB_POSTGRESDB_DATABASE="${POSTGRES_DB:-carlanding}"
  export DB_POSTGRESDB_USER="carno_migrator"
  export DB_POSTGRESDB_PASSWORD="${CARNO_MIGRATOR_DB_PASSWORD:-$CARNO_MIGRATOR_PASS}"
  export DB_POSTGRESDB_SCHEMA=n8n
  export N8N_USER_FOLDER="$N8N_DATA_DIR"
  export N8N_PORT=5678
  export N8N_LISTEN_ADDRESS=127.0.0.1
  export WEBHOOK_URL="http://127.0.0.1:5678/"
  export N8N_BASIC_AUTH_ACTIVE=true
  export N8N_BASIC_AUTH_USER="${N8N_BASIC_AUTH_USER:-admin}"
  export N8N_BASIC_AUTH_PASSWORD="${N8N_AUTH_SECRET:-changeme_to_secure_secret}"
  export N8N_ENCRYPTION_KEY="$RESOLVED_N8N_KEY"
  export N8N_DIAGNOSTICS_ENABLED=false
  export N8N_VERSION_NOTIFICATIONS_ENABLED=false

  # Start n8n engine in background
  n8n start > "$N8N_DATA_DIR/n8n.log" 2>&1 &
  N8N_PID=$!

  # Wait for n8n to complete database migrations and become ready
  N8N_READY=0
  for i in {1..35}; do
    if curl -s http://127.0.0.1:5678/healthz 2>/dev/null | grep -q "ok"; then
      N8N_READY=1
      break
    fi
    sleep 1
  done

  if [ "$N8N_READY" -eq 1 ]; then
    echo "  ✓ n8n engine v2 online on 127.0.0.1:5678 (PID $N8N_PID, PostgreSQL backend, internal only)."
    # Import template workflow only if first boot and file exists
    if [ -f /app/n8n-payment-workflow.json ] && [ ! -f "$N8N_DATA_DIR/.workflow_imported" ]; then
      echo "  → Importing Carno SMS Payment workflow template..."
      n8n import:workflow --input=/app/n8n-payment-workflow.json >/dev/null 2>&1 || true
      touch "$N8N_DATA_DIR/.workflow_imported"
    fi
  else
    echo "  ! [WARNING] n8n engine did not respond on /healthz within 35s. Recent logs:"
    tail -n 15 "$N8N_DATA_DIR/n8n.log" 2>/dev/null || true
  fi
else
  echo "  - n8n skipped (ENABLE_N8N=false or binary not installed)."
fi

# ------------------------------------------------------------------------------
# 5. Background SMS Dispatch Worker
# ------------------------------------------------------------------------------
echo "[5/6] Starting SMS Worker Daemon..."
npm run worker:sms &
WORKER_PID=$!
echo "  ✓ SMS Worker spawned in background (PID $WORKER_PID)."

# ------------------------------------------------------------------------------
# 6. Dual-Port Forwarder & Next.js Server Launch
# ------------------------------------------------------------------------------
echo "[6/6] Initializing HTTP Ingress & Next.js Server..."

APP_PORT="${PORT:-3000}"

# If running as root, bridge port 80 to 3000 seamlessly
if [ "$APP_PORT" != "80" ]; then
  node -e "
  const http = require('http');
  const server = http.createServer((req, res) => {
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
  });
  server.on('error', () => {});
  server.listen(80, '0.0.0.0', () => console.log('  ✓ Dual-Port Bridge: Port 80 forwarded to 3000'));
  " &
  BRIDGE_PID=$!
fi

export HOSTNAME="0.0.0.0"
export PORT=3000

echo "=================================================="
echo "  CARNO STACK READY — LAUNCHING NEXT.JS WEB SERVER"
echo "  Public URL: ${NEXT_PUBLIC_BASE_URL:-https://khodrekab.ir}"
echo "=================================================="

npx next start -H 0.0.0.0 -p 3000 &
NEXT_PID=$!

# Wait for Next.js to keep container alive and handle signals
wait "$NEXT_PID"

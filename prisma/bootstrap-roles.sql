-- ==============================================================================
-- CARNO DATABASE BOOTSTRAP: ROLES, SHADOW DB & OBJECT OWNERSHIP
-- ==============================================================================
-- Target: PostgreSQL 16
-- Scope: Gate C0 Baseline Setup
-- Executed as superuser 'postgres'
-- ==============================================================================

-- Parameter resolution: supports psql -v migrator_password=... / -v app_password=...
-- or environment variables KHODREKAB_* / CARNO_* via \getenv
\if :{?migrator_password}
\else
  \getenv migrator_password KHODREKAB_MIGRATOR_DB_PASSWORD
  \if :{?migrator_password}
  \else
    \getenv migrator_password CARNO_MIGRATOR_DB_PASSWORD
  \endif
\endif

\if :{?app_password}
\else
  \getenv app_password KHODREKAB_APP_DB_PASSWORD
  \if :{?app_password}
  \else
    \getenv app_password CARNO_APP_DB_PASSWORD
  \endif
\endif

\if :{?migrator_password}
\else
  \echo 'FATAL: migrator_password is required. Pass via -v migrator_password=... or env KHODREKAB_MIGRATOR_DB_PASSWORD / CARNO_MIGRATOR_DB_PASSWORD'
  \q
\endif

\if :{?app_password}
\else
  \echo 'FATAL: app_password is required. Pass via -v app_password=... or env KHODREKAB_APP_DB_PASSWORD / CARNO_APP_DB_PASSWORD'
  \q
\endif

-- 1. Create or update carno_migrator (strictly NO CREATEROLE, NO CREATEDB)
SELECT format(
  'DO $role$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = %L) THEN
       CREATE ROLE %I WITH LOGIN PASSWORD %L;
     ELSE
       ALTER ROLE %I WITH PASSWORD %L;
     END IF;
   END $role$;',
  'carno_migrator', 'carno_migrator', :'migrator_password',
  'carno_migrator', :'migrator_password'
) \gexec

GRANT CONNECT ON DATABASE carlanding TO carno_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO carno_migrator;

-- 2. Explicitly transfer public schema ownership in carlanding
ALTER SCHEMA public OWNER TO carno_migrator;

-- 3. Reassign ownership of ALL existing tables, sequences, enums, and views in public schema
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  -- Reassign all existing tables in public schema
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO carno_migrator;';
  END LOOP;

  -- Reassign all existing sequences in public schema
  FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
    EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequence_name) || ' OWNER TO carno_migrator;';
  END LOOP;

  -- Reassign all existing custom enums (UserStatus, PaymentStatus, ReferralStatus, etc.)
  FOR r IN (SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e') LOOP
    EXECUTE 'ALTER TYPE public.' || quote_ident(r.typname) || ' OWNER TO carno_migrator;';
  END LOOP;

  -- Reassign any existing views
  FOR r IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') LOOP
    EXECUTE 'ALTER VIEW public.' || quote_ident(r.table_name) || ' OWNER TO carno_migrator;';
  END LOOP;
END $$;

-- 4. Create or update carno_app runtime role (DML only, strictly no DDL)
SELECT format(
  'DO $role$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = %L) THEN
       CREATE ROLE %I WITH LOGIN PASSWORD %L;
     ELSE
       ALTER ROLE %I WITH PASSWORD %L;
     END IF;
   END $role$;',
  'carno_app', 'carno_app', :'app_password',
  'carno_app', :'app_password'
) \gexec

GRANT CONNECT ON DATABASE carlanding TO carno_app;
GRANT USAGE ON SCHEMA public TO carno_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO carno_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO carno_app;

-- Configure default privileges for future tables/sequences created by carno_migrator
ALTER DEFAULT PRIVILEGES FOR ROLE carno_migrator IN SCHEMA public 
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO carno_app;

ALTER DEFAULT PRIVILEGES FOR ROLE carno_migrator IN SCHEMA public 
GRANT USAGE, SELECT ON SEQUENCES TO carno_app;

-- 5. Enforce Least-Privilege DDL Lockdown:
-- In PostgreSQL, privileges aggregate from PUBLIC. Revoking CREATE from both PUBLIC and carno_app
-- guarantees that carno_app cannot inherit schema modification privileges.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM carno_app;
GRANT USAGE ON SCHEMA public TO carno_app;
GRANT USAGE, CREATE ON SCHEMA public TO carno_migrator;

#!/usr/bin/env bash
set -eo pipefail

# CIVIL-LEX Automated Disaster Recovery Restore from Cloudflare R2
# Restores compressed database schema, vector records, and storage files.

# Disable AWS CLI v2 flexible/CRC64 checksums to maintain compatibility with Cloudflare R2
export AWS_REQUEST_CHECKSUM_CALCULATION="WHEN_REQUIRED"
export AWS_RESPONSE_CHECKSUM_VALIDATION="WHEN_REQUIRED"

BUCKET_NAME="civilex-db-backups"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RESTORE_BASE_DIR="$PROJECT_ROOT/backups/restore_staging"

# Verify command dependencies
for cmd in aws docker gzip tar gunzip sed awk; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: Required command '$cmd' is not installed or not in PATH."
    exit 1
  fi
done

# Verify Supabase Docker containers
DB_CID=$(docker ps -qf "name=supabase_db_civilex-thesis" | head -n 1)
STORAGE_CID=$(docker ps -qf "name=supabase_storage_civilex-thesis" | head -n 1)

if [ -z "$DB_CID" ]; then
  echo "Error: Target PostgreSQL container 'supabase_db_civilex-thesis' is not running."
  echo "Please start Supabase via 'npx supabase start' before initiating disaster recovery."
  exit 1
fi

if [ -z "$STORAGE_CID" ]; then
  echo "Warning: Target Storage container 'supabase_storage_civilex-thesis' is not running."
fi

# Parse CLI arguments
REQUESTED_BACKUP=""
FORCE_RESTORE=false
CORPUS_ONLY=false
FORCE_SCHEMA=false
TAKE_BACKUP=true

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)
      FORCE_RESTORE=true
      shift
      ;;
    --corpus-only|--knowledge-base-only)
      CORPUS_ONLY=true
      shift
      ;;
    --force-schema)
      FORCE_SCHEMA=true
      shift
      ;;
    --no-backup)
      TAKE_BACKUP=false
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [SNAPSHOT_TIMESTAMP] [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  -y, --yes              Skip interactive confirmation prompts"
      echo "  --corpus-only          Restore only legal corpus tables (preserves local users and chats)"
      echo "  --force-schema         Force re-running schema DDL even if tables already exist"
      echo "  --no-backup            Skip pre-restore safety backup of active database"
      echo "  -h, --help             Show this help message"
      exit 0
      ;;
    *)
      if [ -z "$REQUESTED_BACKUP" ] && [[ ! "$1" =~ ^- ]]; then
        REQUESTED_BACKUP="$1"
      else
        echo "Error: Unknown option or multiple timestamps provided: $1"
        exit 1
      fi
      shift
      ;;
  esac
done

# Determine target backup timestamp
if [ -z "$REQUESTED_BACKUP" ]; then
  echo "Querying available backups from Cloudflare R2 (s3://$BUCKET_NAME/)..."
  AVAILABLE_BACKUPS=($(aws s3 ls "s3://$BUCKET_NAME/" --profile r2 | awk '{print $2}' | grep '/' | tr -d '/' | sort -r))
  if [ ${#AVAILABLE_BACKUPS[@]} -eq 0 ]; then
    echo "Error: No backups found in Cloudflare R2 bucket '$BUCKET_NAME'."
    exit 1
  fi
  TARGET_BACKUP="${AVAILABLE_BACKUPS[0]}"
  echo "Selected latest available backup snapshot: $TARGET_BACKUP"
else
  TARGET_BACKUP="$REQUESTED_BACKUP"
  echo "Targeting specified backup snapshot: $TARGET_BACKUP"
fi

# Confirmation prompt unless skipped via -y or --yes
if [ "$FORCE_RESTORE" = false ]; then
  echo ""
  echo "Restore Target: PostgreSQL container 'supabase_db_civilex-thesis'"
  if [ "$CORPUS_ONLY" = true ]; then
    echo "Restore Scope: Legal Corpus Only (articles, jurisprudence, relations, vector chunks)"
    echo "Note: Local user accounts, uploaded documents, and chat sessions will be preserved."
  else
    echo "Restore Scope: Full Disaster Recovery (all public tables, auth users, storage objects)"
  fi
  echo "Existing matching tables will be cleanly refreshed with snapshot data to prevent duplicate key conflicts."
  if [ "$TAKE_BACKUP" = true ]; then
    echo "A safety backup will be created in backups/pre_restore_<timestamp> prior to restoration."
  fi
  echo ""
  read -p "Are you sure you want to proceed with restore from snapshot '$TARGET_BACKUP'? (y/N): " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Disaster recovery aborted by user."
    exit 0
  fi
fi

STAGING_DIR="$RESTORE_BASE_DIR/$TARGET_BACKUP"
mkdir -p "$STAGING_DIR"

cleanup() {
  if [ -d "$RESTORE_BASE_DIR" ]; then
    rm -rf "$RESTORE_BASE_DIR"
  fi
}
trap cleanup EXIT

# Pre-restore safety backup
if [ "$TAKE_BACKUP" = true ]; then
  PRE_BACKUP_TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  PRE_BACKUP_DIR="$PROJECT_ROOT/backups/pre_restore_$PRE_BACKUP_TIMESTAMP"
  mkdir -p "$PRE_BACKUP_DIR"
  echo "Creating pre-restore safety backup of active database in $PRE_BACKUP_DIR..."
  (docker exec -i "$DB_CID" pg_dump -U postgres --data-only --schema public,auth,storage postgres 2>/dev/null | gzip -c > "$PRE_BACKUP_DIR/pre_restore_safety_backup.sql.gz") || true
  if [ -s "$PRE_BACKUP_DIR/pre_restore_safety_backup.sql.gz" ]; then
    echo "Safety backup created: $PRE_BACKUP_DIR/pre_restore_safety_backup.sql.gz"
  else
    rm -rf "$PRE_BACKUP_DIR"
  fi
fi

# Capture pre-restore baseline metrics
echo "Recording pre-restore baseline metrics..."
BEFORE_ARTICLES=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.civil_code_articles;" 2>/dev/null | tr -d ' ' || echo "0")
BEFORE_CASES=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.jurisprudence_cases;" 2>/dev/null | tr -d ' ' || echo "0")
BEFORE_RELATIONS=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.article_jurisprudence_relations;" 2>/dev/null | tr -d ' ' || echo "0")
BEFORE_CHUNKS=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.document_chunks;" 2>/dev/null | tr -d ' ' || echo "0")
BEFORE_USERS=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM auth.users;" 2>/dev/null | tr -d ' ' || echo "0")
BEFORE_CHATS=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.chat_sessions;" 2>/dev/null | tr -d ' ' || echo "0")
BEFORE_STORAGE=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM storage.objects;" 2>/dev/null | tr -d ' ' || echo "0")
START_TIME=$(date +%s)

# Step 1: Download backup archive from Cloudflare R2
echo "[1/5] Downloading backup snapshot from Cloudflare R2 (s3://$BUCKET_NAME/$TARGET_BACKUP)..."
aws s3 cp "s3://$BUCKET_NAME/$TARGET_BACKUP" "$STAGING_DIR" \
  --profile r2 \
  --recursive

# Step 2: Restore physical storage volume
if [ "$CORPUS_ONLY" = true ]; then
  echo "[2/5] Skipping physical storage restoration (--corpus-only mode active)."
else
  echo "[2/5] Restoring physical storage files..."
  if [ -f "$STAGING_DIR/supabase_storage_backup.tar.gz" ] && [ -n "$STORAGE_CID" ]; then
    EXTRACT_DIR="$STAGING_DIR/storage_extracted"
    mkdir -p "$EXTRACT_DIR"
    tar -xzf "$STAGING_DIR/supabase_storage_backup.tar.gz" -C "$EXTRACT_DIR"
    docker cp "$EXTRACT_DIR/." "$STORAGE_CID":/mnt/
    rm -rf "$EXTRACT_DIR"
    echo "      Storage files restored to container $STORAGE_CID"
  else
    echo "      Notice: Storage archive missing or storage container offline. Skipping physical files."
  fi
fi

# Step 3: Ensure required PostgreSQL extensions
echo "[3/5] Verifying PostgreSQL extensions in database container..."
docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;"

# Step 4: Restore database schema
echo "[4/5] Evaluating database schema state..."
PUBLIC_TABLES_COUNT=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ' || echo "0")

if [ "$PUBLIC_TABLES_COUNT" -gt 0 ] && [ "$FORCE_SCHEMA" = false ]; then
  echo "      Database schema already active ($PUBLIC_TABLES_COUNT public tables present)."
  echo "      Skipping redundant schema DDL to prevent constraint and relation conflicts."
else
  echo "      Applying database schema DDL into PostgreSQL..."
  if [ -f "$STAGING_DIR/supabase_schema.sql.gz" ]; then
    gunzip -c "$STAGING_DIR/supabase_schema.sql.gz" | docker exec -i "$DB_CID" psql -U supabase_admin -d postgres
  elif [ -f "$STAGING_DIR/supabase_schema.sql" ]; then
    docker exec -i "$DB_CID" psql -U supabase_admin -d postgres < "$STAGING_DIR/supabase_schema.sql"
  else
    echo "      Notice: Schema file not found. Skipping schema injection."
  fi
  
  POST_SCHEMA_COUNT=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ' || echo "0")
  if [ "$POST_SCHEMA_COUNT" -gt 0 ]; then
    echo "      Database schema applied successfully ($POST_SCHEMA_COUNT public tables initialized)."
  else
    echo "      Warning: Schema applied but 0 public tables detected."
  fi
fi

# Step 5: Restore database records, vectors, and metadata
echo "[5/5] Restoring database records and vector embeddings..."

if [ "$CORPUS_ONLY" = true ]; then
  echo "      Truncating existing legal corpus tables to prevent duplicate key conflicts..."
  docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "
    SET session_replication_role = replica;
    TRUNCATE TABLE 
      public.article_jurisprudence_relations,
      public.document_chunks,
      public.jurisprudence_cases,
      public.civil_code_articles
    CASCADE;
  "
else
  echo "      Truncating existing tables to prevent duplicate key conflicts..."
  docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "
    DO \$\$
    DECLARE
        r RECORD;
    BEGIN
        SET session_replication_role = replica;
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE;';
        END LOOP;
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'storage' AND tablename IN ('objects', 'buckets', 's3_multipart_uploads', 's3_multipart_uploads_parts')) LOOP
            EXECUTE 'TRUNCATE TABLE storage.' || quote_ident(r.tablename) || ' CASCADE;';
        END LOOP;
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'auth' AND tablename NOT IN ('schema_migrations')) LOOP
            EXECUTE 'TRUNCATE TABLE auth.' || quote_ident(r.tablename) || ' CASCADE;';
        END LOOP;
    END \$\$;
  "
fi

DATA_FILE=""
if [ -f "$STAGING_DIR/supabase_data.sql.gz" ]; then
  DATA_FILE="$STAGING_DIR/supabase_data.sql.gz"
elif [ -f "$STAGING_DIR/supabase_data.sql" ]; then
  DATA_FILE="$STAGING_DIR/supabase_data.sql"
fi

if [ -n "$DATA_FILE" ]; then
  echo "      Streaming data records into PostgreSQL (monitoring per-table COPY progress)..."
  
  STREAM_CMD="cat \"$DATA_FILE\""
  if [[ "$DATA_FILE" == *.gz ]]; then
    STREAM_CMD="gunzip -c \"$DATA_FILE\""
  fi

  if [ "$CORPUS_ONLY" = true ]; then
    eval "$STREAM_CMD" | \
      awk '
        BEGIN { in_target = 1; }
        /^COPY / {
          if ($2 ~ /^"public"\."(civil_code_articles|jurisprudence_cases|article_jurisprudence_relations|document_chunks)"/) {
            in_target = 1;
          } else {
            in_target = 0;
          }
        }
        in_target { print }
        /^\\\./ { in_target = 1; }
      ' | \
      sed -E 's/^COPY "([^"]+)"\."([^"]+)"/\\echo '\''  [Restoring] \1.\2...'\''\n&/' | \
      docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
  else
    eval "$STREAM_CMD" | \
      sed -E 's/^COPY "([^"]+)"\."([^"]+)"/\\echo '\''  [Restoring] \1.\2...'\''\n&/' | \
      docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
  fi
  echo "      Database records and vectors restored successfully."
else
  echo "      Notice: Data dump file not found. Skipping data injection."
fi

# Restart storage service to refresh cached tokens and directory structures
if [ -n "$STORAGE_CID" ] && [ "$CORPUS_ONLY" = false ]; then
  echo "Restarting Supabase Storage service to synchronize permissions..."
  docker restart "$STORAGE_CID" >/dev/null
fi

# Post-restore integrity verification and metrics
echo ""
echo "Running post-restore integrity and metrics validation..."
AFTER_ARTICLES=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.civil_code_articles;" 2>/dev/null | tr -d ' ' || echo "0")
AFTER_CASES=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.jurisprudence_cases;" 2>/dev/null | tr -d ' ' || echo "0")
AFTER_RELATIONS=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.article_jurisprudence_relations;" 2>/dev/null | tr -d ' ' || echo "0")
AFTER_CHUNKS=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.document_chunks;" 2>/dev/null | tr -d ' ' || echo "0")
AFTER_USERS=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM auth.users;" 2>/dev/null | tr -d ' ' || echo "0")
AFTER_CHATS=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.chat_sessions;" 2>/dev/null | tr -d ' ' || echo "0")
AFTER_STORAGE=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM storage.objects;" 2>/dev/null | tr -d ' ' || echo "0")

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))

echo ""
echo "Database Rehydration Summary (Snapshot: $TARGET_BACKUP):"
printf "%-38s | %-16s | %-16s\n" "Entity" "Before Restore" "After Restore"
printf "%s\n" "---------------------------------------+------------------+-----------------"
printf "%-38s | %-16s | %-16s\n" "Civil Code Articles" "$BEFORE_ARTICLES" "$AFTER_ARTICLES"
printf "%-38s | %-16s | %-16s\n" "Jurisprudence Cases" "$BEFORE_CASES" "$AFTER_CASES"
printf "%-38s | %-16s | %-16s\n" "Article-Case Relations" "$BEFORE_RELATIONS" "$AFTER_RELATIONS"
printf "%-38s | %-16s | %-16s\n" "Knowledge Graph Vectors / Chunks" "$BEFORE_CHUNKS" "$AFTER_CHUNKS"
printf "%-38s | %-16s | %-16s\n" "Storage Objects (Files & Avatars)" "$BEFORE_STORAGE" "$AFTER_STORAGE"
printf "%-38s | %-16s | %-16s\n" "Auth Users" "$BEFORE_USERS" "$AFTER_USERS"
printf "%-38s | %-16s | %-16s\n" "Chat Sessions" "$BEFORE_CHATS" "$AFTER_CHATS"
echo "----------------------------------------------------------------------------"
echo "Disaster recovery restore completed successfully in ${MINUTES}m ${SECONDS}s."

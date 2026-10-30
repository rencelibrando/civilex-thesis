#!/usr/bin/env bash
set -e

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
for cmd in aws docker gzip tar gunzip; do
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

# Determine target backup timestamp
REQUESTED_BACKUP="$1"
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
FORCE_RESTORE=false
if [ "$2" = "-y" ] || [ "$2" = "--yes" ] || [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
  FORCE_RESTORE=true
fi

if [ "$FORCE_RESTORE" = false ]; then
  echo ""
  echo "WARNING: Disaster recovery restore will overwrite existing records in the database."
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

# Step 1: Download backup archive from Cloudflare R2
echo "[1/5] Downloading backup snapshot from Cloudflare R2 (s3://$BUCKET_NAME/$TARGET_BACKUP)..."
aws s3 cp "s3://$BUCKET_NAME/$TARGET_BACKUP" "$STAGING_DIR" \
  --profile r2 \
  --recursive

# Step 2: Restore physical storage volume
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

# Step 3: Ensure required PostgreSQL extensions
echo "[3/5] Verifying PostgreSQL extensions in database container..."
docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -c \
  "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;"

# Step 4: Restore database schema
echo "[4/5] Restoring database schema..."
if [ -f "$STAGING_DIR/supabase_schema.sql.gz" ]; then
  gunzip -c "$STAGING_DIR/supabase_schema.sql.gz" | docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -q
  echo "      Database schema restored successfully."
elif [ -f "$STAGING_DIR/supabase_schema.sql" ]; then
  docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -q < "$STAGING_DIR/supabase_schema.sql"
  echo "      Database schema restored successfully."
else
  echo "      Notice: Schema file not found. Skipping schema injection."
fi

# Step 5: Restore database records, vectors, and metadata
echo "[5/5] Restoring database records and vector embeddings..."
if [ -f "$STAGING_DIR/supabase_data.sql.gz" ]; then
  gunzip -c "$STAGING_DIR/supabase_data.sql.gz" | docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -q
  echo "      Database records and vectors restored successfully."
elif [ -f "$STAGING_DIR/supabase_data.sql" ]; then
  docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -q < "$STAGING_DIR/supabase_data.sql"
  echo "      Database records and vectors restored successfully."
else
  echo "      Notice: Data dump file not found. Skipping data injection."
fi

# Restart storage service to refresh cached tokens and directory structures
if [ -n "$STORAGE_CID" ]; then
  echo "Restarting Supabase Storage service to synchronize permissions..."
  docker restart "$STORAGE_CID" >/dev/null
fi

# Post-restore integrity verification
echo "Running post-restore integrity check..."
ARTICLE_COUNT=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.civil_code_articles;" 2>/dev/null | tr -d ' ' || echo "0")
CHUNK_COUNT=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.document_chunks;" 2>/dev/null | tr -d ' ' || echo "0")
CASE_COUNT=$(docker exec -i "$DB_CID" psql -U supabase_admin -d postgres -t -c "SELECT COUNT(*) FROM public.jurisprudence_cases;" 2>/dev/null | tr -d ' ' || echo "0")

echo "Integrity Verification Summary:"
echo "  - Civil Code & Family Code Articles: $ARTICLE_COUNT"
echo "  - Knowledge Graph Chunks & Vectors:   $CHUNK_COUNT"
echo "  - Supreme Court Jurisprudence Cases: $CASE_COUNT"

echo "Disaster recovery restore completed successfully from snapshot $TARGET_BACKUP."


#!/usr/bin/env bash
set -e

# CIVIL-LEX Automated Database & Storage Backup to Cloudflare R2
# Includes: Gzip compression, Cloudflare R2 upload, and Auto-prune of oldest backup

BUCKET_NAME="civilex-db-backups"
MAX_BACKUPS=2  # Keep the 2 most recent backups to stay well within 10 GB free tier
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_ROOT/backups/$TIMESTAMP"

mkdir -p "$BACKUP_DIR"


echo " Starting CIVIL-LEX Backup: $TIMESTAMP"
echo " Retention Policy: Max $MAX_BACKUPS backups in Cloudflare R2"


# Step 1: Export Database Schema & Compress
echo "[1/4] Exporting database schema..."
(cd "$PROJECT_ROOT" && npx supabase db dump --local --schema public,auth,storage -f "$BACKUP_DIR/supabase_schema.sql")
gzip -f "$BACKUP_DIR/supabase_schema.sql"
echo "       Schema compressed: supabase_schema.sql.gz"

# Step 2: Export Database Records & Vectors & Compress
echo "[2/4] Exporting database records and vectors..."
(cd "$PROJECT_ROOT" && npx supabase db dump --local --data-only --use-copy --schema public,auth,storage -f "$BACKUP_DIR/supabase_data.sql")
echo "       Compressing database dump (saves ~75% storage)..."
gzip -f -4 "$BACKUP_DIR/supabase_data.sql"
echo "       Data dump compressed: supabase_data.sql.gz"

# Step 3: Export Physical Storage Files (PDFs / Attachments)
echo "[3/4] Archiving physical storage files..."
STORAGE_CID=$(docker ps -qf "name=supabase_storage_civilex-thesis" | head -n 1)
if [ -n "$STORAGE_CID" ]; then
  docker cp "$STORAGE_CID":/mnt "$BACKUP_DIR/storage_files" 2>/dev/null || true
  if [ -d "$BACKUP_DIR/storage_files" ]; then
    tar -czf "$BACKUP_DIR/supabase_storage_backup.tar.gz" -C "$BACKUP_DIR/storage_files" .
    rm -rf "$BACKUP_DIR/storage_files"
    echo "       Storage files packaged: supabase_storage_backup.tar.gz"
  fi
else
  echo "       Notice: Supabase storage container not found. Skipping file volume copy."
fi

# Step 4: Upload New Backup to Cloudflare R2
echo "Uploading compressed backup to Cloudflare R2 (s3://$BUCKET_NAME/$TIMESTAMP)..."
aws s3 cp "$BACKUP_DIR" "s3://$BUCKET_NAME/$TIMESTAMP" \
  --profile r2 \
  --recursive

echo "Upload complete: s3://$BUCKET_NAME/$TIMESTAMP"

# Step 5: Enforce Retention Policy (Auto-Delete Oldest Backup on Cloudflare R2)
echo "Checking retention policy in Cloudflare R2..."
EXISTING_BACKUPS=($(aws s3 ls "s3://$BUCKET_NAME/" --profile r2 | awk '{print $2}' | grep '/' | tr -d '/' | sort))
TOTAL_BACKUPS=${#EXISTING_BACKUPS[@]}

echo "Current backups in R2 ($TOTAL_BACKUPS / $MAX_BACKUPS max):"
for b in "${EXISTING_BACKUPS[@]}"; do
  echo "  - $b"
done

if [ "$TOTAL_BACKUPS" -gt "$MAX_BACKUPS" ]; then
  COUNT_TO_DELETE=$((TOTAL_BACKUPS - MAX_BACKUPS))
  echo "Pruning $COUNT_TO_DELETE oldest backup(s) to guarantee free tier compliance..."
  for ((i=0; i<COUNT_TO_DELETE; i++)); do
    OLDEST="${EXISTING_BACKUPS[$i]}"
    echo "Deleting oldest backup from Cloudflare R2: s3://$BUCKET_NAME/$OLDEST/ ..."
    aws s3 rm "s3://$BUCKET_NAME/$OLDEST" --recursive --profile r2
    echo "Deleted: s3://$BUCKET_NAME/$OLDEST/"
  done
else
  echo "Retention check passed. No backups need to be pruned."
fi

# Clean up older local backups to save Fedora disk space (keep only current)
find "$PROJECT_ROOT/backups" -mindepth 1 -maxdepth 1 -type d ! -name "$TIMESTAMP" -exec rm -rf {} + 2>/dev/null || true


echo " Backup & Retention Pipeline Finished Successfully!"
echo " Total Backups Remaining in Cloudflare R2: $(aws s3 ls "s3://$BUCKET_NAME/" --profile r2 | awk '{print $2}' | grep '/' | wc -l)"


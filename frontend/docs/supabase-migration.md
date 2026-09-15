# Supabase Local Database Migration Guide

This guide outlines the steps to migrate a local Supabase database (including schema, vectors, and embeddings) from one machine (the "Source") to another (the "Destination").

## Prerequisites
- Both machines must have **Docker** and the **Supabase CLI** installed.
- Your project folder (containing the `supabase/` directory) must exist on both machines.

---

## Stage 1: Exporting from the Source Machine

1. Open your terminal and navigate to your project directory (the folder where you originally ran `supabase start`).
2. Make sure your local Supabase containers are running:
   ```bash
   supabase status
   ```
3. Export the Database Schema (Table structures, extensions, functions):
   ```bash
   supabase db dump --local -f supabase_schema.sql
   ```
4. Export the Database Data (Your actual document chunks, embeddings, and records):
   ```bash
   supabase db dump --local --data-only -f supabase_data.sql
   ```
5. You should now have two files: `supabase_schema.sql` and `supabase_data.sql`. 
6. Transfer these two files to the Destination Machine (via USB, Google Drive, network share, etc.).

---

## Stage 2: Importing to the Destination Machine

1. On the Destination Machine, move the `supabase_schema.sql` and `supabase_data.sql` files into your project folder.
2. Open your terminal and navigate to that project folder.
3. If you haven't initialized Supabase on this machine yet, run:
   ```bash
   supabase init
   ```
4. Start your local Supabase instance:
   ```bash
   supabase start
   ```
5. Import the Schema. This must be done first so that tables and the `pgvector` extensions exist before data is inserted:
   ```bash
   supabase db psql < supabase_schema.sql
   ```
6. Import the Data. Depending on the size of your embeddings, this may take a few moments:
   ```bash
   supabase db psql < supabase_data.sql
   ```

## Verification

Once the import finishes, your database is fully migrated. You can verify the data by opening Supabase Studio on the Destination Machine:
```bash
# Usually available at http://127.0.0.1:54323
```
Check your tables (e.g., `document_chunks`, `civil_code_articles`) to ensure the rows and vectors transferred successfully.

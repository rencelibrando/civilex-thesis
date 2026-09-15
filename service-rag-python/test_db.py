import psycopg2
conn = psycopg2.connect("postgresql://postgres:postgres@127.0.0.1:54322/postgres")
cur = conn.cursor()
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public';")
tables = cur.fetchall()
print("Tables in public schema:")
for t in tables:
    print("-", t[0])
conn.close()

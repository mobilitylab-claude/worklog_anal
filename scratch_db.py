import sqlite3

try:
    conn = sqlite3.connect('scratch_db.db')
    cursor = conn.cursor()
    
    print("=== worklog_results ===")
    cursor.execute("SELECT id, schedule_id, target_date, created_at, report_type, total_hours FROM worklog_results ORDER BY created_at DESC LIMIT 10;")
    for row in cursor.fetchall():
        print(row)
        
    conn.close()
except Exception as e:
    print(f"Error: {e}")

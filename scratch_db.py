import sqlite3

try:
    conn = sqlite3.connect('jira_filters.db')
    cursor = conn.cursor()
    
    print("=== TABLES ===")
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [r[0] for r in cursor.fetchall()]
    print(tables)
    
    cursor.execute("SELECT id, schedule_type, target_mode, created_at FROM worklog_schedules;")
    for r in cursor.fetchall():
        print("Schedule:", r)

    print("\n=== LATEST 10 worklog_results ===")
    cursor.execute("SELECT id, schedule_id, target_date, created_at, report_type, total_hours FROM worklog_results ORDER BY id DESC LIMIT 10;")
    for r in cursor.fetchall():
        print(r)

    print("\n=== LATEST 5 report_results ===")
    if 'report_results' in tables:
        cursor.execute("SELECT id, scheduled_report_id, report_month, target_period, total_hours, created_at FROM report_results ORDER BY id DESC LIMIT 5;")
        for r in cursor.fetchall():
            print(r)
            
    conn.close()
except Exception as e:
    import traceback
    traceback.print_exc()

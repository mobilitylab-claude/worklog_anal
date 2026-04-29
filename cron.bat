@echo off
cd /d "%~dp0"
node --env-file=.env scripts/cron-run.mjs >> cron_log.txt 2>&1

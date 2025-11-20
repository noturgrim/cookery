@echo off
echo ========================================
echo  Database Migration Script
echo ========================================
echo.
echo This will migrate your database to a new PostgreSQL instance.
echo Make sure you have your new database credentials ready!
echo.
echo Press any key to start, or Ctrl+C to cancel...
pause >nul

node migrate-database.js

echo.
echo ========================================
echo  Migration script finished
echo ========================================
pause


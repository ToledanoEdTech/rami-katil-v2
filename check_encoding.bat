@echo off
echo ============================================
echo    בדיקת קידוד קבצים
echo ============================================

cd /d "C:\Users\matan\Desktop\‏‏תיקיה חדשה (3)\rami-katil-v2"

echo מצב גיט...
git status

echo.
echo הגדרות גיט...
git config --list | findstr "encoding"

echo.
echo בודק קידוד של קבצים עיקריים...
echo.

echo App.tsx:
powershell -command "Get-Content 'App.tsx' -Encoding UTF8 -TotalCount 5"

echo.
echo constants.ts:
powershell -command "Get-Content 'constants.ts' -Encoding UTF8 -TotalCount 5"

echo.
echo GameEngine.ts:
powershell -command "Get-Content 'game\GameEngine.ts' -Encoding UTF8 -TotalCount 5"

echo.
echo אם אתה רואה סימנים מוזרים, הרץ את fix_encoding.bat
echo אם זה נראה טוב אבל גיטהב מציג מוזר, הרץ את export_clean.bat

pause

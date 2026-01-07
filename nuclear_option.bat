@echo off
echo ============================================
echo    אפשרות גרעינית - ניקוי מוחלט
echo ============================================

cd /d "C:\Users\matan\Desktop\‏‏תיקיה חדשה (3)\rami-katil-v2"

echo גיבוי קבצים חשובים...
if exist "backup" rmdir /s /q "backup"
mkdir backup

copy "App.tsx" "backup\" >nul
copy "constants.ts" "backup\" >nul
copy "game\GameEngine.ts" "backup\" >nul
copy "package.json" "backup\" >nul
copy "tsconfig.json" "backup\" >nul
copy "index.html" "backup\" >nul
copy "index.tsx" "backup\" >nul

echo מוחק גיט ישן...
if exist ".git" rmdir /s /q ".git"

echo מאתחל גיט חדש...
git init
git config user.name "ToledanoEdTech"
git config user.email "toledanoedtech@gmail.com"
git config core.autocrlf false
git config i18n.commitEncoding utf-8
git config i18n.logOutputEncoding utf-8

echo מוסיף קבצים מהגיבוי...
copy "backup\*" "." >nul

git add .

echo commit נקי...
git commit -m "משחק רמי וקטיל - גרסה נקייה עם כל השדרוגים"

echo מחבר לריפו...
git remote add origin https://github.com/ToledanoEdTech/rami-katil-v2.git

echo דוחף עם force מוחלט...
git push origin main --force --set-upstream

if errorlevel 1 (
    echo.
    echo ❌ עדיין נכשל
    echo.
    echo פתרונות אחרונים:
    echo 1. בדוק אם יש לך הרשאות כתיבה בריפו
    echo 2. נסה את new_repo.bat לריפו חדש
    echo 3. העלה ידנית דרך github.com
    echo.
) else (
    echo.
    echo ============================================
    echo    ✅ הצליח! גיט נקי וסונכרן
    echo ============================================
)

pause

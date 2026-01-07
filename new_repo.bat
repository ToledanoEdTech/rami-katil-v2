@echo off
echo ============================================
echo    יצירת ריפו חדש לגיטהב
echo ============================================

cd /d "C:\Users\matan\Desktop\‏‏תיקיה חדשה (3)\rami-katil-v2"

echo יוצר תיקיית גיבוי...
if not exist "C:\rami-katil-final" mkdir "C:\rami-katil-final"

echo מעתיק קבצים...
xcopy "*" "C:\rami-katil-final\" /E /H /C /I /Y /EXCLUDE:exclude.txt

echo עובר לתיקייה החדשה...
cd /d "C:\rami-katil-final"

echo מאתחל גיט חדש...
if exist ".git" rmdir /s /q ".git"
git init
git config user.name "ToledanoEdTech"
git config user.email "toledanoedtech@gmail.com"
git config core.autocrlf false

echo מוסיף קבצים...
git add .

echo commit ראשון...
git commit -m "משחק רמי וקטיל - גרסה סופית עם כל השדרוגים"

echo.
echo ============================================
echo    הוראות ליצירת ריפו חדש:
echo ============================================
echo.
echo 1. היכנס ל: https://github.com/new
echo 2. שם הריפו: rami-katil-v2-final
echo 3. אל תיצור README, .gitignore או license
echo 4. לחץ Create repository
echo.
echo 5. העתק את הקישור של הריפו החדש
echo 6. הדבק אותו כאן ולחץ Enter:
echo.

set /p repo_url=

if "%repo_url%"=="" (
    echo לא הוזן קישור. יוצא...
    pause
    exit /b 1
)

echo מחבר לריפו החדש...
git remote add origin "%repo_url%"

echo דוחף לריפו החדש...
git push -u origin main

if errorlevel 1 (
    echo.
    echo ❌ נכשל. בדוק את הקישור או הרשאות
) else (
    echo.
    echo ============================================
    echo    ✅ הצליח! הקבצים בריפו החדש
    echo ============================================
    echo הקישור החדש: %repo_url%
)

pause

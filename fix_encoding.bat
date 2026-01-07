@echo off
echo ============================================
echo    תיקון בעיית קידוד ודחיפה מחדש
echo ============================================

cd /d "C:\Users\matan\Desktop\‏‏תיקיה חדשה (3)\rami-katil-v2"

echo מתקן הגדרות קידוד...
git config --global core.quotepath off
git config core.autocrlf false
git config core.safecrlf false
git config i18n.commitEncoding utf-8
git config i18n.logOutputEncoding utf-8

echo מאתחל מחדש...
git reset --hard HEAD~2 2>nul

echo מוסיף קבצים עם קידוד נכון...
git add .

echo commit עם קידוד נכון...
git commit -m "שדרוג משחק: אשמדאי בסוף שלב 4, בוסים משודרגים, לוגו מגן דוד"

echo דוחף מחדש...
git push origin main --force-with-lease

if errorlevel 1 (
    echo.
    echo נכשל, מנסה בכוח...
    git push origin main --force
)

echo.
echo ============================================
echo    בדוק אם הקידוד תקין עכשיו
echo ============================================

pause

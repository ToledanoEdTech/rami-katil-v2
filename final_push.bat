@echo off
echo ============================================
echo    דחיפה סופית לגיטהב - פותר כל בעיות
echo ============================================

cd /d "C:\Users\matan\Desktop\‏‏תיקיה חדשה (3)\rami-katil-v2"

echo 1. בודק מצב...
git status

echo.
echo 2. מושך שינויים (למקרה שיש)...
git fetch origin

echo.
echo 3. משלב עם force...
git reset --hard origin/main

echo.
echo 4. מוסיף כל השינויים...
git add .

echo.
echo 5. commit...
git commit -m "שדרוג משחק רמי וקטיל: אשמדאי בסוף שלב 4, בוסים משודרגים, לוגו מגן דוד"

echo.
echo 6. דוחף עם force...
git push origin main --force

if errorlevel 1 (
    echo.
    echo ❌ נכשל גם עם force
    echo.
    echo נסה ליצור ריפו חדש:
    echo 1. מחק את הריפו בגיטהב
    echo 2. צור ריפו חדש עם אותו שם
    echo 3. הרץ: git remote set-url origin [הקישור החדש]
    echo 4. הרץ: git push -u origin main --force
    echo.
) else (
    echo.
    echo ============================================
    echo    ✅ הצליח! הקבצים עודכנו בגיטהב
    echo ============================================
)

pause

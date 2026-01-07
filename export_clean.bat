@echo off
echo ============================================
echo    ייצוא קבצים נקיים ודחיפה מחדש
echo ============================================

cd /d "C:\Users\matan\Desktop\‏‏תיקיה חדשה (3)\rami-katil-v2"

echo יוצר תיקיית ייצוא נקי...
if exist "clean_export" rmdir /s /q "clean_export"
mkdir "clean_export"

echo מעתיק קבצים עיקריים...
copy "App.tsx" "clean_export\" >nul
copy "constants.ts" "clean_export\" >nul
copy "game\GameEngine.ts" "clean_export\" >nul
copy "package.json" "clean_export\" >nul
copy "tsconfig.json" "clean_export\" >nul
copy "index.html" "clean_export\" >nul
copy "index.tsx" "clean_export\" >nul

echo עובר לתיקיית הייצוא...
cd clean_export

echo מאתחל גיט חדש...
git init
git config user.name "ToledanoEdTech"
git config user.email "toledanoedtech@gmail.com"
git config core.autocrlf false
git config i18n.commitEncoding utf-8
git config i18n.logOutputEncoding utf-8

echo מוסיף קבצים...
git add .

echo commit...
git commit -m "שדרוג משחק רמי וקטיל: אשמדאי בסוף שלב 4, בוסים משודרגים, לוגו מגן דוד"

echo מחבר לריפו...
git remote add origin https://github.com/ToledanoEdTech/rami-katil-v2.git

echo דוחף...
git push -u origin main --force

cd ..

echo.
echo ============================================
echo    הקבצים הנקיים נדחפו לגיטהב
echo ============================================

pause

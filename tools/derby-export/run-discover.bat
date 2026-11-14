@echo off
setlocal

set DERBY_JAR=E:\RomStation\app\lib\derby-10.14.2.0.jar
if not exist "%DERBY_JAR%" (
  echo Introuvable : %DERBY_JAR%
  echo Adapte le chemin dans ce script si RomStation est installe ailleurs.
  pause
  exit /b 1
)

cd /d "%~dp0"

echo Execution (RomStation doit etre completement ferme avant ce lancement)...
java -cp ".;%DERBY_JAR%" Discover "E:/RomStation/app/database" > discover-output.txt 2>&1

echo Termine. Resultat dans discover-output.txt
echo.
type discover-output.txt
pause

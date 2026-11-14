@echo off
setlocal

set DERBY_JAR=E:\RomStation\app\lib\derby-10.14.2.0.jar
if not exist "%DERBY_JAR%" (
  echo Introuvable : %DERBY_JAR%
  pause
  exit /b 1
)

cd /d "%~dp0"

echo Export en cours (RomStation doit etre completement ferme)...
java -cp ".;%DERBY_JAR%" Export "E:/RomStation/app/database" "export.json" > export-log.txt 2>&1

echo Termine.
type export-log.txt
pause

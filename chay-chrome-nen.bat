@echo off
rem ============================================================================
rem  Muse Auto - mo Chrome voi cac co giup tab/cua so bi che khuat van chay binh thuong.
rem
rem  PROFILE = ten THU MUC cua profile chay Muse Auto:
rem    Profile 1  = "2. PhucTD"  <- dang dung
rem    Default    = "1. PhucTD_PAM"
rem    (xem day du: chrome://version  -> dong "Profile Path", lay phan cuoi)
rem
rem  LUU Y: phai DONG HET Chrome truoc khi chay tep nay. Neu Chrome dang mo,
rem  cac co ben duoi se bi bo qua (cua so moi gan vao tien trinh Chrome cu).
rem  Cac co ap dung cho ca phien Chrome do (moi profile mo sau cung huong).
rem ============================================================================
set "PROFILE=Profile 1"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Khong tim thay chrome.exe. Hay sua duong dan CHROME trong tep nay.
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | find /I "chrome.exe" >nul
if not errorlevel 1 (
  echo Chrome dang mo. Hay dong HET cua so Chrome ^(ke ca icon o khay he thong^) roi chay lai tep nay.
  pause
  exit /b 1
)

start "" "%CHROME%" --profile-directory="%PROFILE%" ^
  --disable-background-timer-throttling ^
  --disable-renderer-backgrounding ^
  --disable-backgrounding-occluded-windows ^
  --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling ^
  "https://muse.ai/thread/new"

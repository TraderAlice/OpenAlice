@echo off
set "OPENALICE_CLI_BIN=%~n0"
if defined OPENALICE_MANAGED_PI_NODE_PATH (
  set "ELECTRON_RUN_AS_NODE=1"
  "%OPENALICE_MANAGED_PI_NODE_PATH%" "%~dp0openalice-cli.cjs" %*
  exit /b %errorlevel%
)
node "%~dp0openalice-cli.cjs" %*

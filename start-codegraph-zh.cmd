@echo off
setlocal
set "CODEGRAPH_UI=1"
set "CODEGRAPH_VIEWER_PATH=C:\Users\zwb\.codex\codegraph-viewer-zh"
cd /d "%~dp0"
call codegraph ui %*
endlocal

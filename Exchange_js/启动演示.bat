@echo off
chcp 65001 >nul
rem 双击我启动演示（Windows）——先装好并打开 Docker Desktop
rem %~dp0 = 本文件所在目录（相对定位，不写死路径）——解压到哪个文件夹都能跑
cd /d "%~dp0"
echo ========================================
echo   正在启动演示（首次需几分钟构建，请联网）
echo   起来后浏览器打开:
echo     管理台 http://localhost:18081
echo     客户端 http://localhost:18082
echo     账号 admin@fiatx.com  密码 123456
echo ========================================
echo.
docker compose up --build
echo.
echo 演示已停止。按任意键关闭窗口。
pause

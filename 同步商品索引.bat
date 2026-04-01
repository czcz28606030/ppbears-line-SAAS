@echo off
chcp 65001 >nul
title PPBears 商品索引同步工具
echo.
echo ╔═══════════════════════════════════════════════╗
echo ║   PPBears 產品索引同步工具 - 暫存模式          ║
echo ║   商品會先同步到暫存區，不影響正在運作的系統   ║
echo ╚═══════════════════════════════════════════════╝
echo.
echo 正在啟動同步...
echo.
cd /d "%~dp0"
npx tsx scripts/sync_products_local.ts
echo.
echo 同步完成！請至管理後台「產品索引」頁面點選「套用暫存索引」。
echo.
pause

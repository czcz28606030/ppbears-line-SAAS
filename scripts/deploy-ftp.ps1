param(
    [string]$TargetPath = "/ppbears-backend",
    [string]$LocalPath = "packages\backend\dist"
)

$FTP_HOST = "178.16.135.30"
$FTP_USER = "u141631622.caca28606030"
$FTP_PASS = 'M@eXVDP+0|l'
$WINSCP_PATH = "C:\Program Files (x86)\WinSCP\WinSCP.com"

if (-not (Test-Path $WINSCP_PATH)) {
    Write-Error "WinSCP.com not found at $WINSCP_PATH. Please install WinSCP from https://winscp.net"
    exit 1
}

if (-not (Test-Path $LocalPath)) {
    Write-Error "Build output not found at $LocalPath — please run 'npm run build -w packages/backend' first."
    exit 1
}

Write-Host "=== PPBears-LINE FTP Deployment ===" -ForegroundColor Cyan
Write-Host "Uploading $LocalPath → FTP $FTP_HOST$TargetPath" -ForegroundColor Yellow

$encodedPass = [Uri]::EscapeDataString($FTP_PASS)

& $WINSCP_PATH /command `
    "open ftp://${FTP_USER}:${encodedPass}@${FTP_HOST}/" `
    "synchronize remote $LocalPath $TargetPath -delete" `
    "exit"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ FTP upload successful!" -ForegroundColor Green
} else {
    Write-Error "❌ FTP upload failed with exit code $LASTEXITCODE"
    exit 1
}

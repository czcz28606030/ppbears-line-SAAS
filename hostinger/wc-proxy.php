<?php
/**
 * WooCommerce API Proxy v2
 *
 * 放置位置：Hostinger public_html/wc-proxy.php
 * 用途：讓 Render 後端透過此腳本呼叫 WooCommerce API，
 *       繞過 Imunify360 對外部 IP 的封鎖
 *
 * v2 改進：使用 http://localhost + Host header，讓請求走本機迴路 (127.0.0.1)
 *         徹底繞過 Imunify360 的外部 IP 過濾與 Bot Protection
 */

define('PROXY_SECRET', 'ppbx_8f3a2c9d7b1e4f6a0e5d2c8b');

// ── 1. 驗證 Secret ──────────────────────────────────────────────
$incoming = $_SERVER['HTTP_X_PROXY_SECRET'] ?? '';
if ($incoming !== PROXY_SECRET) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

// ── 2. 取得 API path ────────────────────────────────────────────
$path = trim($_GET['path'] ?? '', '/');
if ($path === '') {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Missing path parameter']);
    exit;
}

// ── 3. 轉發所有其他 query 參數
$params = $_GET;
unset($params['path']);
$queryString = !empty($params) ? '?' . http_build_query($params) : '';

// ── 4. 用 localhost 迴路呼叫（IP=127.0.0.1，完全繞過 Imunify360）
//       Host header 告訴 LiteSpeed 這是 www.ppbears.com 的請求
$wooUrl = 'http://localhost/wp-json/wc/v3/' . $path . $queryString;

$ch = curl_init($wooUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 20,
    CURLOPT_FOLLOWLOCATION => true,   // 跟隨 HTTP→HTTPS 重定向
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER     => [
        'Host: www.ppbears.com',
        'Accept: application/json',
    ],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
]);

$body    = curl_exec($ch);
$code    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

// ── 5. 若 localhost 失敗，改用 https://www 作為備援
if ($curlErr || $code === 0) {
    $fallbackUrl = 'https://www.ppbears.com/wp-json/wc/v3/' . $path . $queryString;
    $ch2 = curl_init($fallbackUrl);
    curl_setopt_array($ch2, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    $body    = curl_exec($ch2);
    $code    = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch2);
    curl_close($ch2);
}

// ── 6. 回傳結果
header('Content-Type: application/json');

if ($curlErr) {
    http_response_code(502);
    echo json_encode(['error' => 'Proxy cURL error: ' . $curlErr]);
    exit;
}

http_response_code($code);
echo $body;

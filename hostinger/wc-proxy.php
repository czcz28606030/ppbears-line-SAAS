<?php
/**
 * WooCommerce API Proxy
 *
 * 放置位置：Hostinger public_html/wc-proxy.php
 * 用途：讓 Render 後端透過此腳本呼叫 WooCommerce API，
 *       繞過 Imunify360 對外部 IP 的封鎖（本機呼叫不受限制）
 *
 * 環境變數（Render）:
 *   WOO_PROXY_URL    = https://www.ppbears.com/wc-proxy.php
 *   WOO_PROXY_SECRET = <與此檔案 PROXY_SECRET 相同的字串>
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
// 例：path=orders/134002 或 path=orders
$path = trim($_GET['path'] ?? '', '/');
if ($path === '') {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Missing path parameter']);
    exit;
}

// ── 3. 轉發所有其他 query 參數（consumer_key, consumer_secret, search, per_page…）
$params = $_GET;
unset($params['path']);
$queryString = !empty($params) ? '?' . http_build_query($params) : '';

// ── 4. 在本機呼叫 WooCommerce（從同一台伺服器出發，IP 為 127.0.0.1）
$wooUrl = 'https://www.ppbears.com/wp-json/wc/v3/' . $path . $queryString;

$ch = curl_init($wooUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 20,
    CURLOPT_USERAGENT      => 'PPBears-WC-Proxy/1.0',
    CURLOPT_SSL_VERIFYPEER => false,   // 本機迴路，跳過 SSL 憑證驗證
    CURLOPT_SSL_VERIFYHOST => 0,
]);

$body     = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

// ── 5. 回傳結果 ─────────────────────────────────────────────────
header('Content-Type: application/json');

if ($curlErr) {
    http_response_code(502);
    echo json_encode(['error' => 'Proxy cURL error: ' . $curlErr]);
    exit;
}

http_response_code($httpCode);
echo $body;

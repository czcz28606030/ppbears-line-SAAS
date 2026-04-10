<?php
/**
 * WooCommerce API Proxy v3 — Direct WordPress PHP Integration
 *
 * 放置位置：Hostinger public_html/wc-proxy.php
 *
 * v3 策略：不發任何 HTTP 請求，直接 require_once(wp-load.php) 載入 WordPress，
 *          然後用 WooCommerce PHP 函式查詢訂單。
 *          Imunify360 的 WAF 只攔截 HTTP 請求路徑，PHP 內部函式呼叫完全不受影響。
 */

// 抑制 PHP notice/warning 避免污染 JSON 輸出
error_reporting(0);
ini_set('display_errors', '0');

define('PROXY_SECRET', 'ppbx_8f3a2c9d7b1e4f6a0e5d2c8b');

header('Content-Type: application/json; charset=utf-8');

// ── 1. 驗證 Secret ──────────────────────────────────────────────
$incoming = $_SERVER['HTTP_X_PROXY_SECRET'] ?? '';
if ($incoming !== PROXY_SECRET) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

// ── 2. 載入 WordPress ───────────────────────────────────────────
$wpLoad = $_SERVER['DOCUMENT_ROOT'] . '/wp-load.php';
if (!file_exists($wpLoad)) {
    http_response_code(500);
    echo json_encode(['error' => 'wp-load.php not found', 'doc_root' => $_SERVER['DOCUMENT_ROOT']]);
    exit;
}
require_once($wpLoad);

// ── 3. 路由 ──────────────────────────────────────────────────────
$path    = trim($_GET['path'] ?? '', '/');
$perPage = max(1, min(20, intval($_GET['per_page'] ?? 10)));
$search  = trim($_GET['search'] ?? '');

if (preg_match('#^orders/(\d+)$#', $path, $m)) {
    // GET /orders/{id}
    $order = wc_get_order(intval($m[1]));
    if (!$order) {
        http_response_code(404);
        echo json_encode(['message' => 'Order not found', 'code' => 'woocommerce_rest_shop_order_invalid_id']);
        exit;
    }
    echo json_encode(order_to_array($order));

} elseif ($path === 'orders') {
    // GET /orders  (with optional search)
    $results = [];

    if ($search !== '') {
        // 1) 嘗試直接用 ID 查
        $o = wc_get_order(intval($search));
        if ($o instanceof WC_Order) {
            $results = [$o];
        }

        // 2) 用 billing_email 搜尋
        if (empty($results)) {
            $results = wc_get_orders([
                'billing_email' => $search,
                'limit'         => $perPage,
                'status'        => 'any',
            ]);
        }

        // 3) 用 billing_phone 搜尋（meta query）
        if (empty($results)) {
            $results = wc_get_orders([
                'limit'         => $perPage,
                'status'        => 'any',
                'meta_key'      => '_billing_phone',
                'meta_value'    => $search,
                'meta_compare'  => 'LIKE',
            ]);
        }
    } else {
        $results = wc_get_orders(['limit' => $perPage, 'status' => 'any']);
    }

    echo json_encode(array_values(array_filter(array_map('order_to_array', $results))));

} else {
    http_response_code(400);
    echo json_encode(['error' => 'Unknown path: ' . $path]);
}

// ── helper ───────────────────────────────────────────────────────
function order_to_array($order) {
    if (!$order || !($order instanceof WC_Order)) return null;

    $lineItems = [];
    foreach ($order->get_items() as $item) {
        $lineItems[] = [
            'name'     => $item->get_name(),
            'quantity' => (int) $item->get_quantity(),
            'total'    => (string) $item->get_total(),
        ];
    }

    $shippingLines = [];
    foreach ($order->get_shipping_methods() as $shipping) {
        $shippingLines[] = [
            'method_title' => $shipping->get_method_title(),
            'method_id'    => $shipping->get_method_id(),
        ];
    }

    $metaData = [];
    foreach ($order->get_meta_data() as $meta) {
        $metaData[] = ['key' => $meta->key, 'value' => $meta->value];
    }

    $datePaid    = $order->get_date_paid();
    $dateCreated = $order->get_date_created();

    return [
        'id'                   => $order->get_id(),
        'number'               => (string) $order->get_order_number(),
        'status'               => $order->get_status(),
        'date_created'         => $dateCreated ? $dateCreated->date('Y-m-d\TH:i:s') : '',
        'total'                => (string) $order->get_total(),
        'currency'             => $order->get_currency(),
        'billing'              => [
            'first_name' => $order->get_billing_first_name(),
            'last_name'  => $order->get_billing_last_name(),
            'email'      => $order->get_billing_email(),
            'phone'      => $order->get_billing_phone(),
        ],
        'shipping'             => [
            'first_name' => $order->get_shipping_first_name(),
            'last_name'  => $order->get_shipping_last_name(),
            'address_1'  => $order->get_shipping_address_1(),
            'city'       => $order->get_shipping_city(),
            'state'      => $order->get_shipping_state(),
            'postcode'   => $order->get_shipping_postcode(),
        ],
        'line_items'           => $lineItems,
        'shipping_lines'       => $shippingLines,
        'payment_method_title' => $order->get_payment_method_title(),
        'date_paid'            => $datePaid ? $datePaid->date('Y-m-d\TH:i:s') : null,
        'meta_data'            => $metaData,
    ];
}

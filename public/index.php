<?php
declare(strict_types=1);

// Plesk-Fallback: viele Hosts liefern index.php, aber blockieren index.html im Unterordner.
$indexFile = __DIR__ . '/index.html';
if (!is_file($indexFile)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'index.html fehlt in ' . __DIR__;
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache');
readfile($indexFile);

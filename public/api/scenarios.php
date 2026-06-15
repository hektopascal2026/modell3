<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$configFile = null;
foreach ([
    __DIR__ . '/config.local.php',
    dirname(__DIR__, 3) . '/private/scenario-config.php', // Plesk: ausserhalb httpdocs
    dirname(__DIR__) . '/private/scenario-config.php',
] as $candidate) {
    if (is_file($candidate)) {
        $configFile = $candidate;
        break;
    }
}
if ($configFile === null) {
    http_response_code(500);
    echo json_encode(['error' => 'config.local.php fehlt — bitte von config.example.php kopieren.']);
    exit;
}

$config = require $configFile;
$dataFile = $config['data_file'] ?? (__DIR__ . '/../scenarios/scenarios.json');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Scenario-Key');
    http_response_code(204);
    exit;
}

if ($method === 'GET') {
    if (!is_file($dataFile)) {
        echo json_encode(['scenarios' => new stdClass()], JSON_UNESCAPED_UNICODE);
        exit;
    }
    readfile($dataFile);
    exit;
}

if ($method === 'POST') {
    $key = $_SERVER['HTTP_X_SCENARIO_KEY'] ?? '';
    $expected = (string) ($config['api_key'] ?? '');
    if ($expected === '' || $key === '' || !hash_equals($expected, $key)) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized — X-Scenario-Key ungültig.']);
        exit;
    }

    $body = file_get_contents('php://input');
    $decoded = json_decode($body ?: '', true);
    if (!is_array($decoded)) {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültiges JSON.']);
        exit;
    }

    $dir = dirname($dataFile);
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        http_response_code(500);
        echo json_encode(['error' => 'Verzeichnis konnte nicht erstellt werden.']);
        exit;
    }

    $json = json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        http_response_code(500);
        echo json_encode(['error' => 'JSON-Encoding fehlgeschlagen.']);
        exit;
    }

    if (file_put_contents($dataFile, $json . "\n", LOCK_EX) === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Datei konnte nicht geschrieben werden — Schreibrechte prüfen.']);
        exit;
    }

    echo json_encode([
        'ok' => true,
        'updatedAt' => $decoded['_meta']['updatedAt'] ?? null,
        'updatedBy' => $decoded['_meta']['updatedBy'] ?? null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);

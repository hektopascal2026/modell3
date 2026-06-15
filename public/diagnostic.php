<?php
declare(strict_types=1);

header('Content-Type: text/plain; charset=UTF-8');

echo "OK — PHP läuft in modell3\n\n";
echo "Ordner: " . __DIR__ . "\n";
echo "index.html: " . (is_file(__DIR__ . '/index.html') ? 'ja' : 'NEIN') . "\n";
echo "index.php: " . (is_file(__DIR__ . '/index.php') ? 'ja' : 'NEIN') . "\n";
echo "api/scenarios.php: " . (is_file(__DIR__ . '/api/scenarios.php') ? 'ja' : 'NEIN') . "\n\n";

echo "Dateien hier:\n";
foreach (scandir(__DIR__) ?: [] as $entry) {
    if ($entry === '.' || $entry === '..') continue;
    $path = __DIR__ . '/' . $entry;
    $type = is_dir($path) ? 'dir ' : 'file';
    $readable = is_readable($path) ? 'r' : '-';
    echo "  [$readable] $type  $entry\n";
}

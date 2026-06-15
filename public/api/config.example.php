<?php
/**
 * Auf dem Server als config.local.php kopieren und API-Key anpassen.
 * Muss mit VITE_SCENARIO_API_KEY im Build übereinstimmen.
 */
return [
    'api_key' => 'hier-einen-langen-zufaelligen-schluessel-eintragen',
    'data_file' => __DIR__ . '/../scenarios/scenarios.json',
];

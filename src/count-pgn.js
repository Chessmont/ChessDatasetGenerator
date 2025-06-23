#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';

/**
 * Script simple pour compter le nombre de parties dans un ou plusieurs fichiers PGN (avec streaming)
 * Modifiez la variable FILE_PATHS ci-dessous pour pointer vers vos fichiers
 */

// 📁 CONFIGURATION - Modifiez cette liste selon vos besoins
const baseDir = './scripts/output/';
const FILE_PATHS = [
  "chessmont.pgn",
];

function countGamesInPGN(filePath) {
  return new Promise((resolve, reject) => {
    try {
      // Vérifier que le fichier existe
      if (!fs.existsSync(filePath)) {
        console.error(`❌ Fichier non trouvé: ${filePath}`);
        process.exit(1);
      }

      // Obtenir les infos du fichier
      const fileStats = fs.statSync(filePath);
      const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

      console.log(`📖 Streaming du fichier: ${path.basename(filePath)}`);
      console.log(`📏 Taille: ${fileSizeMB} MB`);
      console.log(`⏳ Comptage en cours...`);

      const startTime = Date.now();

      // Créer un stream de lecture
      const readStream = createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 64 * 1024 // Buffer de 64KB
      });

      let buffer = '';
      let gameCount = 0;

      readStream.on('data', (chunk) => {
        buffer += chunk;

        // Chercher toutes les occurrences de [Event dans ce chunk + buffer
        let match;
        const regex = /\[Event /g;

        while ((match = regex.exec(buffer)) !== null) {
          gameCount++;
        }

        // Garder seulement la fin du buffer pour éviter de couper un [Event entre deux chunks
        const lastEventIndex = buffer.lastIndexOf('[Event ');
        if (lastEventIndex > 0) {
          buffer = buffer.substring(lastEventIndex);
        }
      });

      readStream.on('end', () => {
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        console.log(`📊 Résultats pour: ${path.basename(filePath)}`);
        console.log(`   Taille du fichier: ${fileSizeMB} MB`);
        console.log(`   Nombre de parties: ${gameCount.toLocaleString()}`);
        console.log(`⏱️  Temps de traitement: ${duration}s`);

        resolve(gameCount);
      });

      readStream.on('error', (error) => {
        reject(error);
      });

    } catch (error) {
      reject(error);
    }
  });
}

// Script principal - traite tous les fichiers configurés
async function main() {
  try {
    console.log(`🎯 Traitement de ${FILE_PATHS.length} fichier(s) PGN...\n`);

    const results = [];
    let totalGames = 0;
    let totalSizeMB = 0;
    const startTimeGlobal = Date.now();

    for (const fp of FILE_PATHS) {
      const filePath = path.join(baseDir, fp);
      try {
        const gameCount = await countGamesInPGN(filePath);
        const fileStats = fs.statSync(filePath);
        const fileSizeMB = fileStats.size / 1024 / 1024;

        results.push({
          path: filePath,
          games: gameCount,
          sizeMB: fileSizeMB
        });

        totalGames += gameCount;
        totalSizeMB += fileSizeMB;

        console.log(''); // Ligne vide entre les fichiers

      } catch (error) {
        console.error(`❌ Erreur avec ${filePath}: ${error.message}`);
      }
    }

    // Afficher le résumé final
    const endTimeGlobal = Date.now();
    const durationGlobal = ((endTimeGlobal - startTimeGlobal) / 1000).toFixed(2);

    console.log('═'.repeat(60));
    console.log('📊 RÉSUMÉ FINAL');
    console.log('═'.repeat(60));

    results.forEach((result, index) => {
      const percentage = ((result.games / totalGames) * 100).toFixed(1);
      console.log(`${index + 1}. ${path.basename(result.path)}`);
      console.log(`   📈 Parties: ${result.games.toLocaleString()} (${percentage}%)`);
      console.log(`   📏 Taille: ${result.sizeMB.toFixed(2)} MB`);
    });

    console.log('─'.repeat(60));
    console.log(`🏆 TOTAL: ${totalGames.toLocaleString()} parties`);
    console.log(`📦 TAILLE TOTALE: ${totalSizeMB.toFixed(2)} MB`);
    console.log(`⏱️  TEMPS TOTAL: ${durationGlobal}s`);
    console.log('═'.repeat(60));

  } catch (error) {
    console.error(`❌ Erreur globale: ${error.message}`);
    process.exit(1);
  }
}

// Exporter la fonction pour usage en module
export { countGamesInPGN };

// Exécuter directement
main();

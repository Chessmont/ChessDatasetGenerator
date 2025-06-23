#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';

/**
 * Script pour compter le nombre de parties dans un fichier PGN (avec streaming)
 * Usage: node count-pgn.js <fichier.pgn>
 */

function countGamesInPGN(filePath) {
  return new Promise((resolve, reject) => {
    try {

      if (!fs.existsSync(filePath)) {
        console.error(`❌ Fichier non trouvé: ${filePath}`);
        process.exit(1);
      }


      const fileStats = fs.statSync(filePath);
      const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

      console.log(`📖 Streaming du fichier: ${path.basename(filePath)}`);
      console.log(`📏 Taille: ${fileSizeMB} MB`);
      console.log(`⏳ Comptage en cours...`);

      const startTime = Date.now();


      const readStream = createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 64 * 1024
      });

      let buffer = '';
      let gameCount = 0;

      readStream.on('data', (chunk) => {
        buffer += chunk;


        let match;
        const regex = /\[Event /g;

        while ((match = regex.exec(buffer)) !== null) {
          gameCount++;
        }


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


async function main() {

  const inputFile = process.argv[2];

  if (!inputFile) {
    console.log('❌ ERREUR: Fichier PGN requis');
    console.log('');
    console.log('📖 USAGE:');
    console.log('  node count-pgn.js <fichier.pgn>');
    console.log('');
    console.log('📝 EXEMPLES:');
    console.log('  node count-pgn.js ./output/chessmont.pgn');
    console.log('  node count-pgn.js ./output/lichess-all.pgn');
    console.log('  node count-pgn.js C:\\path\\to\\games.pgn');
    console.log('');
    console.log('💡 Le fichier doit avoir l\'extension .pgn');
    process.exit(1);
  }

  try {

    if (!fs.existsSync(inputFile)) {
      console.log(`❌ ERREUR: Fichier introuvable: ${inputFile}`);
      process.exit(1);
    }


    if (!inputFile.toLowerCase().endsWith('.pgn')) {
      console.log(`❌ ERREUR: Le fichier doit avoir l'extension .pgn: ${inputFile}`);
      console.log('💡 Assurez-vous de spécifier un fichier PGN valide');
      process.exit(1);
    }

    console.log(`🎯 Comptage des parties dans: ${path.basename(inputFile)}\n`);

    const startTimeGlobal = Date.now();
    const gameCount = await countGamesInPGN(inputFile);
    const endTimeGlobal = Date.now();

    const durationGlobal = ((endTimeGlobal - startTimeGlobal) / 1000).toFixed(2);
    const fileStats = fs.statSync(inputFile);
    const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

    console.log('\n═'.repeat(60));
    console.log('📊 RÉSUMÉ FINAL');
    console.log('═'.repeat(60));
    console.log(`� Fichier: ${path.basename(inputFile)}`);
    console.log(`📏 Taille: ${fileSizeMB} MB`);
    console.log(`🏆 TOTAL: ${gameCount.toLocaleString()} parties`);
    console.log(`⏱️  TEMPS TOTAL: ${durationGlobal}s`);
    console.log('═'.repeat(60));

  } catch (error) {
    console.error(`❌ ERREUR: ${error.message}`);
    process.exit(1);
  }
}


if (process.argv[1] && process.argv[1].endsWith('count-pgn.js')) {
  main();
}

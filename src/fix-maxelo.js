#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
🔧 Correcteur MaxElo PGN
========================

Usage: node fix-maxelo.js <fichier.pgn>

Description:
  Parcourt toutes les parties d'un fichier PGN et corrige le tag [MaxElo]
  en recalculant Math.max(WhiteElo, BlackElo) pour chaque partie.
  Supprime les parties avec MaxElo > 3500 (données corrompues).

Sortie:
  Crée un fichier <fichier>-fixed.pgn avec les MaxElo corrigés

Exemple:
  node fix-maxelo.js output/chessmont.pgn
  → Génère output/chessmont-fixed.pgn
`);
  process.exit(0);
}

const inputFile = path.resolve(args[0]);

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Fichier introuvable: ${inputFile}`);
  process.exit(1);
}

const outputFile = inputFile.replace(/\.pgn$/, '-fixed.pgn');

console.log('🔧 CORRECTEUR MAXELO PGN');
console.log('=========================');
console.log(`📁 Input:  ${inputFile}`);
console.log(`📄 Output: ${outputFile}\n`);

const fixMaxElo = (gameText) => {
  const whiteEloMatch = gameText.match(/\[WhiteElo "(\d+)"\]/);
  const blackEloMatch = gameText.match(/\[BlackElo "(\d+)"\]/);

  const whiteElo = whiteEloMatch ? parseInt(whiteEloMatch[1]) : 0;
  const blackElo = blackEloMatch ? parseInt(blackEloMatch[1]) : 0;
  const correctMaxElo = Math.max(whiteElo, blackElo);

  if (correctMaxElo > 3500) {
    return null;
  }

  let fixed = gameText.replace(/\[MaxElo "[^"]*"\]\n?/g, '');

  fixed = fixed.replace(
    /(\[Source "[^"]+"\]\n)/,
    `$1[MaxElo "${correctMaxElo}"]\n`
  );

  return fixed;
};

const processFile = () => {
  console.time('⏱️  Traitement');

  const readStream = fs.createReadStream(inputFile, {
    encoding: 'utf8',
    highWaterMark: 16 * 1024 * 1024
  });

  const writeStream = fs.createWriteStream(outputFile, {
    encoding: 'utf8',
    highWaterMark: 16 * 1024 * 1024
  });

  let buffer = '';
  let currentGame = '';
  let inGame = false;
  let gamesProcessed = 0;
  let gamesCorrected = 0;
  let gamesDeleted = 0;
  let lastLogTime = Date.now();

  readStream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('[ID ') || line.startsWith('[Event ')) {
        if (inGame && currentGame.trim()) {
          const oldMaxEloMatch = currentGame.match(/\[MaxElo "(\d+)"\]/);
          const fixedGame = fixMaxElo(currentGame);

          if (fixedGame === null) {
            gamesDeleted++;
          } else {
            const newMaxEloMatch = fixedGame.match(/\[MaxElo "(\d+)"\]/);
            writeStream.write(fixedGame + '\n\n');

            if (oldMaxEloMatch && newMaxEloMatch && oldMaxEloMatch[1] !== newMaxEloMatch[1]) {
              gamesCorrected++;
            }
          }

          gamesProcessed++;

          const now = Date.now();
          if (now - lastLogTime > 1000) {
            process.stdout.write(`\r🔧 Traitées: ${gamesProcessed.toLocaleString()} | Corrigées: ${gamesCorrected.toLocaleString()} | Supprimées: ${gamesDeleted.toLocaleString()}`);
            lastLogTime = now;
          }
        }

        currentGame = line + '\n';
        inGame = true;
      } else {
        currentGame += line + '\n';
      }
    }
  });

  readStream.on('end', () => {
    if (inGame && currentGame.trim()) {
      const fixedGame = fixMaxElo(currentGame);
      if (fixedGame === null) {
        gamesDeleted++;
      } else {
        writeStream.write(fixedGame);
      }
      gamesProcessed++;
    }

    writeStream.end();

    writeStream.on('finish', () => {
      console.log(`\n\n✅ Traitement terminé !`);
      console.log(`📊 Parties traitées: ${gamesProcessed.toLocaleString()}`);
      console.log(`🔧 Parties corrigées: ${gamesCorrected.toLocaleString()}`);
      console.log(`🗑️  Parties supprimées (MaxElo > 3500): ${gamesDeleted.toLocaleString()}`);
      console.log(`📄 Fichier généré: ${outputFile}`);
      console.timeEnd('⏱️  Traitement');
    });
  });

  readStream.on('error', (error) => {
    console.error(`\n❌ Erreur lecture: ${error.message}`);
    process.exit(1);
  });

  writeStream.on('error', (error) => {
    console.error(`\n❌ Erreur écriture: ${error.message}`);
    process.exit(1);
  });
};

processFile();

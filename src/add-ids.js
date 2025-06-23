#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { nanoid } from 'nanoid';

/**
 * Script pour ajouter des IDs nanoid aux parties PGN
 * Usage: node add-ids.js <fichier.pgn>
 */

class SimpleIdAdder {
  constructor(inputFile) {
    if (!inputFile) {
      throw new Error('Fichier d\'entrée requis');
    }

    this.inputFile = inputFile;


    const parsedPath = path.parse(inputFile);
    this.outputFile = path.join(parsedPath.dir, parsedPath.name + '-with-ids' + parsedPath.ext);

    this.totalGamesProcessed = 0;
  }

  /**
   * Point d'entrée principal
   */
  async run() {
    try {
      console.log('🔢 AJOUT D\'IDS AUX PARTIES PGN');
      console.log('===============================');
      console.log(`📁 Input:  ${this.inputFile}`);
      console.log(`📁 Output: ${this.outputFile}`);
      console.log(`🔢 ID: nanoid(12) caractères\n`);

      await this.processFile();

    } catch (error) {
      console.error(`❌ ERREUR: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Traite le fichier PGN pour ajouter les IDs nanoid
   */
  async processFile() {
    const fileName = path.basename(this.inputFile);

    console.log(`🔄 Traitement de ${fileName}...`);

    if (!fs.existsSync(this.inputFile)) {
      throw new Error(`Fichier d'entrée non trouvé: ${this.inputFile}`);
    }


    const inputStats = fs.statSync(this.inputFile);
    const inputSizeMB = (inputStats.size / (1024 * 1024)).toFixed(2);

    console.log(`📊 Taille du fichier: ${inputSizeMB} MB`);
    console.log(`🔄 Ajout des IDs en streaming...`);

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const readStream = createReadStream(this.inputFile, { encoding: 'utf8' });
      const writeStream = createWriteStream(this.outputFile, { encoding: 'utf8' });

      let buffer = '';
      let currentGame = '';
      let gamesProcessed = 0;
      let inGame = false;
      let lastLogTime = Date.now();
      const LOG_INTERVAL = 2000;

      readStream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('[Event ')) {

            if (inGame && currentGame.trim()) {

              const gameId = nanoid(12);
              const gameWithId = `[ID "${gameId}"]\n${currentGame}`;
              writeStream.write(gameWithId);
              gamesProcessed++;


              if (Date.now() - lastLogTime > LOG_INTERVAL) {
                const progress = `🔢 Parties traitées: ${gamesProcessed.toLocaleString()}`;
                const speed = (gamesProcessed / ((Date.now() - startTime) / 1000)).toFixed(0);
                process.stdout.write(`\r${progress} | ⚡ Vitesse: ${speed} parties/s`);
                lastLogTime = Date.now();
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
          const gameId = nanoid(12);
          const gameWithId = `[ID "${gameId}"]\n${currentGame}`;
          writeStream.write(gameWithId);
          gamesProcessed++;
        }

        writeStream.end();

        writeStream.on('finish', async () => {
          const endTime = Date.now();
          const duration = ((endTime - startTime) / 1000).toFixed(1);

          console.log('\n\n✅ AJOUT D\'IDS TERMINÉ !');
          console.log('=========================');


          const outputStats = await fs.promises.stat(this.outputFile);
          const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
          const avgSpeed = (gamesProcessed / ((endTime - startTime) / 1000)).toFixed(0);

          console.log(`📊 Parties traitées: ${gamesProcessed.toLocaleString()}`);
          console.log(`📊 Taille originale: ${inputSizeMB} MB`);
          console.log(`📊 Taille avec IDs: ${outputSizeMB} MB`);
          console.log(`⚡ Vitesse moyenne: ${avgSpeed} parties/s`);
          console.log(`⏱️  Temps total: ${duration}s`);
          console.log(`📁 Fichier créé: ${path.basename(this.outputFile)}`);

          this.totalGamesProcessed = gamesProcessed;
          resolve(gamesProcessed);
        });
      });

      readStream.on('error', reject);
      writeStream.on('error', reject);
    });
  }
}


async function main() {

  const inputFile = process.argv[2];

  if (!inputFile) {
    console.log('❌ ERREUR: Fichier PGN requis');
    console.log('');
    console.log('📖 USAGE:');
    console.log('  node add-ids.js <fichier.pgn>');
    console.log('');
    console.log('📝 EXEMPLES:');
    console.log('  node add-ids.js ./output/chessmont.pgn');
    console.log('  node add-ids.js ./output/lichess-all.pgn');
    console.log('  node add-ids.js C:\\path\\to\\games.pgn');
    console.log('');
    console.log('💡 Le fichier doit avoir l\'extension .pgn');
    console.log('📁 Le fichier de sortie sera: nom-with-ids.pgn');
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

    const idAdder = new SimpleIdAdder(inputFile);
    await idAdder.run();
  } catch (error) {
    console.error(`❌ ERREUR: ${error.message}`);
    process.exit(1);
  }
}


if (process.argv[1] && process.argv[1].endsWith('add-ids.js')) {
  main();
}

export default SimpleIdAdder;

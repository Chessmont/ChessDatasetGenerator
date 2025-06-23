#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { nanoid } from 'nanoid';

// Auto-détection du répertoire comme vos autres scripts
const __dirname = process.cwd();

/**
 * Script simple pour ajouter des IDs nanoid aux parties PGN
 * Configurez vos fichiers dans la constante FILES_TO_PROCESS
 */

// 🎯 CONFIGUREZ VOS FICHIERS ICI
const FILES_TO_PROCESS = [
  './scripts/output/chessmont.pgn'
];

const OUTPUT_DIR = './scripts/output/with-ids';

class SimpleIdAdder {
  constructor() {
    this.totalGamesProcessed = 0;
    this.totalFilesProcessed = 0;
  }

  /**
   * Traite un fichier PGN pour ajouter les IDs nanoid
   */
  async processFile(inputFile) {
    const fileName = path.basename(inputFile);
    const outputFile = path.join(OUTPUT_DIR, fileName);

    console.log(`🔄 Traitement de ${fileName}...`);

    if (!fs.existsSync(inputFile)) {
      console.warn(`⚠️  Fichier non trouvé: ${inputFile}`);
      return 0;
    }

    // Créer le dossier de sortie si nécessaire
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const readStream = createReadStream(inputFile, { encoding: 'utf8' });
      const writeStream = createWriteStream(outputFile, { encoding: 'utf8' });

      let buffer = '';
      let currentGame = '';
      let gamesProcessed = 0;
      let inGame = false;
      let lastLogTime = Date.now();
      const LOG_INTERVAL = 5000; // 5 secondes

      readStream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('[Event ')) {
            // Écrire la partie précédente (avec ID)
            if (inGame && currentGame.trim()) {              // Ajouter l'ID nanoid au début
              const gameId = nanoid(12); // 12 caractères pour sécurité absolue
              const gameWithId = `[ID "${gameId}"]\n${currentGame}`;
              writeStream.write(gameWithId);
              gamesProcessed++;

              // Log de progression
              if (Date.now() - lastLogTime > LOG_INTERVAL) {
                console.log(`   📈 ${gamesProcessed.toLocaleString()} parties traitées`);
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

      readStream.on('end', () => {        // Traiter la dernière partie
        if (inGame && currentGame.trim()) {
          const gameId = nanoid(12);
          const gameWithId = `[ID "${gameId}"]\n${currentGame}`;
          writeStream.write(gameWithId);
          gamesProcessed++;
        }

        writeStream.end();

        writeStream.on('finish', () => {
          console.log(`✅ ${fileName} traité: ${gamesProcessed.toLocaleString()} parties`);
          resolve(gamesProcessed);
        });
      });

      readStream.on('error', reject);
      writeStream.on('error', reject);
    });
  }

  /**
   * Traite tous les fichiers configurés
   */
  async processAllFiles() {
    console.log('🚀 Ajout des IDs nanoid aux parties PGN');
    console.log(`📂 Dossier de sortie: ${OUTPUT_DIR}`);
    console.log(`📁 Fichiers à traiter: ${FILES_TO_PROCESS.length}\n`);

    const startTime = Date.now();

    for (const inputFile of FILES_TO_PROCESS) {
      try {
        const gamesInFile = await this.processFile(inputFile);
        this.totalGamesProcessed += gamesInFile;
        this.totalFilesProcessed++;
      } catch (error) {
        console.error(`❌ Erreur lors du traitement de ${inputFile}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;

    console.log('\n📊 STATISTIQUES FINALES:');
    console.log(`   📁 Fichiers traités: ${this.totalFilesProcessed}/${FILES_TO_PROCESS.length}`);
    console.log(`   🎮 Parties traitées: ${this.totalGamesProcessed.toLocaleString()}`);
    console.log(`   ⏱️  Durée: ${(duration / 1000).toFixed(1)}s`);
    console.log(`   📄 Fichiers générés dans: ${OUTPUT_DIR}`);
  }
}

// Usage
async function main() {
  const adder = new SimpleIdAdder();
  await adder.processAllFiles();
}

// Exécution directe
main().catch(console.error);

export default SimpleIdAdder;

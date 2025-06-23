#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Script de compilation PGN - Réunit plusieurs fichiers PGN en un seul
 * Modifiez les variables ci-dessous selon vos besoins
 */

// 📁 CONFIGURATION - Modifiez selon vos besoins
const INPUT_FILES = [
  './scripts/output/twic-pgnmentor.pgn', 
  './scripts/output/chesscom-2500-180.pgn',
  './scripts/output/lichess-2500-180.pgn',
];

const OUTPUT_FILE = './scripts/output/chessmont.pgn';

class PGNCompiler {
  constructor() {
    this.stats = {
      totalFiles: 0,
      processedFiles: 0,
      totalGames: 0,
      totalSizeMB: 0,
      errors: 0
    };
  }

  /**
   * Compile plusieurs fichiers PGN en un seul
   */
  async compile(inputFiles, outputFile) {
    console.log('🚀 COMPILATION PGN DÉMARRÉE');
    console.log('===========================');

    this.stats.totalFiles = inputFiles.length;
    console.log(`📂 Fichiers d'entrée: ${inputFiles.length}`);
    console.log(`📁 Fichier de sortie: ${outputFile}`);

    // Vérifier que les fichiers d'entrée existent
    const validFiles = await this.validateInputFiles(inputFiles);
    if (validFiles.length === 0) {
      throw new Error('Aucun fichier valide trouvé');
    }

    // Créer le répertoire de sortie si nécessaire
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Créer le fichier de sortie vide
    const writeStream = createWriteStream(outputFile);

    try {
      const startTime = Date.now();

      for (const inputFile of validFiles) {
        this.stats.processedFiles++;
        console.log(`\n📄 [${this.stats.processedFiles}/${validFiles.length}] Traitement: ${path.basename(inputFile)}`);

        await this.processFile(inputFile, writeStream);
        this.showProgress();
      }

      writeStream.end();

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      await this.showFinalStats(outputFile, duration);

    } catch (error) {
      writeStream.destroy();
      throw error;
    }
  }

  /**
   * Valide que les fichiers d'entrée existent et ne sont pas vides
   */
  async validateInputFiles(inputFiles) {
    const validFiles = [];

    for (const file of inputFiles) {
      try {
        if (!fs.existsSync(file)) {
          console.warn(`⚠️  Fichier introuvable: ${file}`);
          continue;
        }

        const stats = await fs.promises.stat(file);
        if (stats.size === 0) {
          console.warn(`⚠️  Fichier vide: ${file}`);
          continue;
        }

        validFiles.push(file);
        console.log(`✅ ${path.basename(file)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

      } catch (error) {
        console.warn(`⚠️  Erreur fichier ${file}: ${error.message}`);
        this.stats.errors++;
      }
    }

    return validFiles;
  }
  /**
   * Traite un fichier et l'ajoute au flux de sortie
   */
  async processFile(inputFile, writeStream) {
    return new Promise((resolve, reject) => {
      const readStream = createReadStream(inputFile, { encoding: 'utf8' });

      let gameCount = 0;
      let processedSize = 0;
      const fileStats = fs.statSync(inputFile);
      const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(1);

      readStream.on('data', (chunk) => {
        processedSize += chunk.length;

        // Compter les parties au passage
        const gameMatches = chunk.match(/\[Event /g);
        if (gameMatches) {
          gameCount += gameMatches.length;
        }

        // Écrire directement le chunk dans le fichier de sortie (pas de buffer)
        writeStream.write(chunk);

        // Afficher le progrès pour les gros fichiers
        if (processedSize % (10 * 1024 * 1024) === 0) { // Tous les 10MB
          const progress = ((processedSize / fileStats.size) * 100).toFixed(1);
          process.stdout.write(`\r  📈 Progrès: ${progress}% (${gameCount} parties)`);
        }
      });

      readStream.on('end', () => {
        // Ajouter une ligne vide entre les fichiers pour séparer
        writeStream.write('\n');

        this.stats.totalGames += gameCount;
        console.log(`\n  ✅ ${path.basename(inputFile)}: ${gameCount.toLocaleString()} parties (${fileSizeMB} MB)`);
        resolve();
      });

      readStream.on('error', (error) => {
        console.error(`❌ Erreur lecture ${inputFile}: ${error.message}`);
        this.stats.errors++;
        reject(error);
      });
    });
  }

  /**
   * Affiche la progression
   */
  showProgress() {
    const progress = ((this.stats.processedFiles / this.stats.totalFiles) * 100).toFixed(1);
    console.log(`📊 Progression: ${progress}% | Parties totales: ${this.stats.totalGames}`);
  }

  /**
   * Affiche les statistiques finales
   */
  async showFinalStats(outputFile, duration) {
    try {
      const outputStats = await fs.promises.stat(outputFile);
      const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(1);

      console.log('\n🏆 COMPILATION TERMINÉE !');
      console.log('=========================');
      console.log(`⏱️  Durée: ${duration}s`);
      console.log(`📊 Fichiers traités: ${this.stats.processedFiles}/${this.stats.totalFiles}`);
      console.log(`📊 Parties totales: ${this.stats.totalGames}`);
      console.log(`📊 Taille finale: ${outputSizeMB} MB`);
      console.log(`📊 Erreurs: ${this.stats.errors}`);
      console.log(`📁 Fichier final: ${outputFile}`);

    } catch (error) {
      console.warn('Impossible de récupérer les stats du fichier final');
    }
  }
}

/**
 * Fonction principale
 */
async function main() {
  console.log('🚀 COMPILATION PGN CHESSMONT');
  console.log('============================');

  try {
    const compiler = new PGNCompiler();
    await compiler.compile(INPUT_FILES, OUTPUT_FILE);

  } catch (error) {
    console.error(`❌ ERREUR: ${error.message}`);
    process.exit(1);
  }
}

// Exécution directe
main();

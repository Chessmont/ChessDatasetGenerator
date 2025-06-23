#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';

// Import de simple-zstd comme dans lichess-processor
import pkg from 'simple-zstd';
const { ZSTDDecompress } = pkg;

class Decompressor {
  constructor() {
    // 🔧 CONFIGURATION - Modifiez ces valeurs selon vos besoins
    this.inputFile = './scripts/output/pgnmentor.zst';  // Fichier à décompresser
    this.outputFile = './scripts/output/pgnmentor.pgn';  // Fichier décompressé
    this.chunkSize = 64 * 1024 * 1024;  // 64MB par chunk
  }

  /**
   * Point d'entrée principal
   */
  async run() {
    try {
      console.log('🔓 DÉCOMPRESSION AVEC ZSTD');
      console.log('===============================');
      console.log(`📁 Input:  ${this.inputFile}`);
      console.log(`📁 Output: ${this.outputFile}`);
      console.log(`📦 Taille des chunks: ${(this.chunkSize / 1024 / 1024).toFixed(0)}MB\n`);

      await this.decompressFile();

    } catch (error) {
      console.error(`❌ ERREUR: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Décompresse le fichier PGN avec ZSTD en streaming
   */
  async decompressFile() {
    if (!fs.existsSync(this.inputFile)) {
      throw new Error(`Fichier d'entrée non trouvé: ${this.inputFile}`);
    }

    // Statistiques du fichier d'entrée
    const inputStats = fs.statSync(this.inputFile);
    const inputSizeMB = (inputStats.size / (1024 * 1024)).toFixed(2);
    const inputSizeGB = (inputStats.size / (1024 * 1024 * 1024)).toFixed(2);

    console.log(`📊 Taille du fichier compressé: ${inputSizeMB} MB (${inputSizeGB} GB)`);
    console.log(`🔄 Démarrage de la décompression streaming...`);

    const startTime = Date.now();
    console.time('⏱️  Décompression totale');

    // Supprimer le fichier de sortie s'il existe
    if (fs.existsSync(this.outputFile)) {
      fs.unlinkSync(this.outputFile);
    }

    return new Promise((resolve, reject) => {
      // Streams : input -> decompress -> output (comme dans lichess-processor)
      const inputStream = createReadStream(this.inputFile, {
        highWaterMark: this.chunkSize
      });
      const decompressStream = ZSTDDecompress();
      const outputStream = createWriteStream(this.outputFile);

      let totalBytesRead = 0;
      let totalBytesWritten = 0;
      let lastLogTime = Date.now();
      const LOG_INTERVAL = 2000;

      // Pipeline de streaming : input -> decompress -> output
      inputStream
        .pipe(decompressStream)
        .pipe(outputStream);

      // Tracking des données lues (fichier compressé)
      inputStream.on('data', (chunk) => {
        totalBytesRead += chunk.length;

        // Afficher le progrès
        const now = Date.now();
        if (now - lastLogTime > LOG_INTERVAL) {
          this.showProgress(totalBytesRead, inputStats.size, totalBytesWritten, startTime);
          lastLogTime = now;
        }
      });

      // Tracking des données écrites (fichier décompressé)
      outputStream.on('data', (chunk) => {
        totalBytesWritten += chunk.length;
      });

      // Gestion des erreurs
      inputStream.on('error', (error) => {
        reject(new Error(`Erreur lecture: ${error.message}`));
      });

      decompressStream.on('error', (error) => {
        reject(new Error(`Erreur décompression: ${error.message}`));
      });

      outputStream.on('error', (error) => {
        reject(new Error(`Erreur écriture: ${error.message}`));
      });

      // Finalisation
      outputStream.on('finish', async () => {
        try {
          console.timeEnd('⏱️  Décompression totale');

          // Statistiques finales avec taille réelle du fichier de sortie
          const outputStats = await fs.promises.stat(this.outputFile);
          this.showFinalStats(inputStats.size, outputStats.size, startTime);
          resolve();
        } catch (error) {
          reject(new Error(`Erreur lors de la finalisation: ${error.message}`));
        }
      });
    });
  }

  /**
   * Affiche le progrès de la décompression
   */
  showProgress(bytesRead, totalBytes, bytesWritten, startTime) {
    const progress = ((bytesRead / totalBytes) * 100).toFixed(1);
    const readMB = (bytesRead / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    const writtenMB = (bytesWritten / (1024 * 1024)).toFixed(1);
    const expansionRatio = bytesRead > 0 ? ((bytesWritten / bytesRead) * 100).toFixed(1) : '0.0';

    const elapsed = (Date.now() - startTime) / 1000;
    const readSpeed = (bytesRead / (1024 * 1024)) / elapsed;
    const writeSpeed = (bytesWritten / (1024 * 1024)) / elapsed;
    const eta = ((totalBytes - bytesRead) / (1024 * 1024)) / readSpeed;

    process.stdout.write(
      `\r🔓 Progression: ${progress}% | ` +
      `📖 Lu: ${readMB}/${totalMB} MB | ` +
      `💾 Écrit: ${writtenMB} MB | ` +
      `📈 Expansion: ${expansionRatio}% | ` +
      `⚡ Vitesse: ${writeSpeed.toFixed(0)} MB/s | ` +
      `⏱️  ETA: ${this.formatTime(eta)}`
    );
  }

  /**
   * Affiche les statistiques finales
   */
  showFinalStats(inputSize, outputSize, startTime) {
    const elapsed = (Date.now() - startTime) / 1000;
    const inputSizeMB = (inputSize / (1024 * 1024)).toFixed(2);
    const outputSizeMB = (outputSize / (1024 * 1024)).toFixed(2);
    const inputSizeGB = (inputSize / (1024 * 1024 * 1024)).toFixed(2);
    const outputSizeGB = (outputSize / (1024 * 1024 * 1024)).toFixed(2);
    const compressionRatio = ((1 - (inputSize / outputSize)) * 100).toFixed(1);
    const avgSpeed = (outputSize / (1024 * 1024)) / elapsed;

    console.log('\n\n✅ DÉCOMPRESSION TERMINÉE !');
    console.log('===========================');
    console.log(`📊 Taille compressée: ${inputSizeMB} MB (${inputSizeGB} GB)`);
    console.log(`📊 Taille décompressée: ${outputSizeMB} MB (${outputSizeGB} GB)`);
    console.log(`🎯 Taux de compression original: ${compressionRatio}%`);
    console.log(`⚡ Vitesse moyenne: ${avgSpeed.toFixed(0)} MB/s`);
    console.log(`⏱️  Temps total: ${this.formatTime(elapsed)}`);
    console.log(`📁 Fichier créé: ${path.basename(this.outputFile)}`);

    // Vérification du fichier
    if (fs.existsSync(this.outputFile)) {
      const stats = fs.statSync(this.outputFile);
      console.log(`✅ Vérification: Fichier créé avec succès (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
      
      // Calcul du facteur d'expansion
      const expansionFactor = (stats.size / inputSize).toFixed(1);
      console.log(`📈 Facteur d'expansion: ${expansionFactor}x`);
    } else {
      console.log(`❌ Erreur: Fichier de sortie non créé`);
    }
  }

  /**
   * Formate un temps en secondes
   */
  formatTime(seconds) {
    if (isNaN(seconds) || seconds <= 0) return '0s';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
    return `${Math.round(seconds / 3600)}h`;
  }
}

// Exécution directe
const decompressor = new Decompressor();
decompressor.run();

export default Decompressor;

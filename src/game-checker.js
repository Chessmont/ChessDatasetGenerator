#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * Script de vérification et nettoyage PGN
 * Usage: node game-checker.js <fichier.pgn>
 */

class GameChecker {
  constructor(inputFile) {
    if (!inputFile) {
      throw new Error('Fichier d\'entrée requis');
    }

    if (!inputFile.toLowerCase().endsWith('.pgn')) {
      throw new Error('Le fichier doit avoir l\'extension .pgn');
    }

    if (!fs.existsSync(inputFile)) {
      throw new Error(`Le fichier ${inputFile} n'existe pas`);
    }

    this.inputFile = inputFile;
    this.cleanedFile = inputFile + '.temp';
    this.logFile = path.join(__dirname, 'output', 'game-check-report.txt');
    this.numWorkers = os.cpus().length;
    this.batchSize = 16;
    this.maxQueueSize = this.numWorkers * 4;
    this.maxGameSize = 50 * 1024 * 1024;
    this.stats = {
      totalGames: 0,
      validGames: 0,
      invalidGames: 0,
      skippedGames: 0,
      errors: {},
      startTime: null,
      fileSize: 0,
      processedBytes: 0
    };
  }

  /**
   * MODE MULTITHREAD: Streaming + worker pool sans accumulation de promesses
   */
  async checkAllGamesMultithread() {
    console.log('🔍 VÉRIFICATION ET NETTOYAGE PGN (MULTITHREAD)');
    console.log('===============================================');
    console.log(`📁 Input: ${this.inputFile}`);
    console.log(`🧹 Cleaned: ${this.cleanedFile}`);
    console.log(`📄 Report: ${this.logFile}`);
    console.log(`🧵 Workers: ${this.numWorkers}`);
    console.log(`📦 Batch size: ${this.batchSize}`);
    console.log(`🚦 Max queue size: ${this.maxQueueSize}\n`);


    [this.cleanedFile, this.logFile].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });


    const outputDir = path.dirname(this.logFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const cleanedStream = fs.createWriteStream(this.cleanedFile, { encoding: 'utf8' });
    const logStream = fs.createWriteStream(this.logFile, { encoding: 'utf8' });

    console.time('⏱️  Vérification totale');
    this.stats.startTime = Date.now();


    const workers = [];
    const workerStates = [];
    const batchQueue = [];
    let isStreamingComplete = false;
    let activeTasks = 0;

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(path.join(__dirname, 'lib', 'game-checker-worker.js'));
      workers.push(worker);
      workerStates.push(true);

      worker.on('message', (message) => {
        if (message.type === 'validGame') {

          cleanedStream.write(message.gameText);
          return;
        }

        if (message.type === 'batchComplete') {
          activeTasks--;
          workerStates[i] = true;

          if (message.success) {

            this.writeInvalidResults(message.result, logStream);

            this.stats.totalGames += message.result.totalGames;
            this.stats.validGames += message.result.validGames;
            this.stats.invalidGames += message.result.invalidGames;

            for (const [errorType, count] of Object.entries(message.result.errors)) {
              this.stats.errors[errorType] = (this.stats.errors[errorType] || 0) + count;
            }


            const elapsed = (Date.now() - this.stats.startTime) / 1000;
            const gamesPerSec = (this.stats.totalGames / elapsed).toFixed(1);
            const eta = this.calculateETA();
            const queueInfo = batchQueue.length > 0 ? ` | Queue: ${batchQueue.length}` : '';
            process.stdout.write(`\r🔍 ${this.stats.totalGames.toLocaleString()} parties | ${this.stats.invalidGames} erreurs | ${this.formatTime(elapsed)} | ${gamesPerSec}/s${eta ? ` | ETA ${eta}` : ''}${queueInfo}`);
          } else {
            console.error(`\nWorker ${i} error:`, message.error);
          }

          processNextBatch();
        }
      });

      worker.on('error', (error) => {
        activeTasks--;
        workerStates[i] = true;
        console.error(`\nWorker ${i} crashed:`, error);
        processNextBatch();
      });
    }


    const processNextBatch = () => {
      const availableWorkerIndex = workerStates.findIndex(state => state === true);

      if (availableWorkerIndex === -1 || batchQueue.length === 0) {
        if (isStreamingComplete && activeTasks === 0 && batchQueue.length === 0) {
          finishProcessing();
        }
        return;
      }

      const batch = batchQueue.shift();
      const worker = workers[availableWorkerIndex];

      workerStates[availableWorkerIndex] = false;
      activeTasks++;

      worker.postMessage({ batch, batchId: Math.random().toString(36) });

      if (streamPaused && batchQueue.length < this.maxQueueSize / 2) {
        streamPaused = false;
        stream.resume();
      }
    };


    const finishProcessing = async () => {
      workers.forEach(worker => worker.terminate());
      cleanedStream.end();
      logStream.end();

      console.log(`\n🎯 Traitement terminé: ${this.stats.totalGames.toLocaleString()} parties testées | ${this.stats.invalidGames} erreurs`);
      console.timeEnd('⏱️  Vérification totale');

      await this.replaceOriginalFile();
      this.showReport();
    };


    const READ_CHUNK_SIZE = 1024 * 1024;
    const stats = fs.statSync(this.inputFile);
    const fileSize = stats.size;
    this.stats.fileSize = fileSize;

    const stream = fs.createReadStream(this.inputFile, { encoding: 'utf8', highWaterMark: READ_CHUNK_SIZE });

    let buffer = '';
    let currentGame = '';
    let inGame = false;
    let currentBatch = [];
    let processedBytes = 0;
    let streamPaused = false;

    stream.on('data', (chunk) => {
      processedBytes += Buffer.byteLength(chunk, 'utf8');
      this.stats.processedBytes = processedBytes;

      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('[Event ')) {
          if (inGame && currentGame.trim()) {

            if (currentGame.length > this.maxGameSize) {
              console.log(`\n⚠️  Partie trop volumineuse ignorée (${(currentGame.length / 1024 / 1024).toFixed(2)} MB)`);
              this.stats.skippedGames++;
            } else {
              currentBatch.push(currentGame);
            }

            if (currentBatch.length >= this.batchSize) {
              batchQueue.push([...currentBatch]);
              currentBatch = [];

              if (!streamPaused && batchQueue.length >= this.maxQueueSize) {
                streamPaused = true;
                stream.pause();
              }

              processNextBatch();
            }
          }

          currentGame = line + '\n';
          inGame = true;
        } else {

          if (currentGame.length + line.length + 1 > this.maxGameSize) {
            console.log(`\n⚠️  Partie en cours trop volumineuse, ignorée`);
            this.stats.skippedGames++;
            currentGame = '';
            inGame = false;
          } else {
            currentGame += line + '\n';
          }
        }
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith('[Event ')) {
          if (inGame && currentGame.trim()) {

            if (currentGame.length > this.maxGameSize) {
              console.log(`\n⚠️  Partie trop volumineuse ignorée (${(currentGame.length / 1024 / 1024).toFixed(2)} MB)`);
              this.stats.skippedGames++;
            } else {
              currentBatch.push(currentGame);
            }
          }
          currentGame = line + '\n';
          inGame = true;
        } else {

          if (currentGame.length + line.length + 1 <= this.maxGameSize) {
            currentGame += line + '\n';
          } else {
            console.log(`\n⚠️  Partie en cours trop volumineuse, ignorée`);
            this.stats.skippedGames++;
            currentGame = '';
            inGame = false;
          }
        }
      }

      if (inGame && currentGame.trim()) {

        if (currentGame.length > this.maxGameSize) {
          console.log(`\n⚠️  Dernière partie trop volumineuse ignorée (${(currentGame.length / 1024 / 1024).toFixed(2)} MB)`);
          this.stats.skippedGames++;
        } else {
          currentBatch.push(currentGame);
        }
      }

      if (currentBatch.length > 0) {
        batchQueue.push(currentBatch);
      }

      isStreamingComplete = true;
      processNextBatch();
    });

    stream.on('error', (error) => {
      console.error('❌ Erreur de lecture du fichier:', error);
      workers.forEach(worker => worker.terminate());
      process.exit(1);
    });
  }

  /**
   * Écrit seulement les parties invalides dans le rapport
   */
  writeInvalidResults(result, logStream) {

    for (const invalid of result.invalidResults) {
      logStream.write(`❌ PARTIE INVALIDE\n`);
      logStream.write(`Erreur: ${invalid.error}\n`);
      logStream.write(`PGN:\n${invalid.gameText}\n`);
      logStream.write(`${'='.repeat(80)}\n\n`);
    }
  }

  /**
   * Remplace le fichier original par la version nettoyée
   */
  async replaceOriginalFile() {
    try {
      console.log('💾 Remplacement du fichier original...');

      const backupFile = this.inputFile + '.backup';
      await fs.promises.rename(this.inputFile, backupFile);
      await fs.promises.rename(this.cleanedFile, this.inputFile);

      console.log(`✅ Fichier nettoyé: ${this.inputFile}`);
      console.log(`📁 Backup sauvé: ${backupFile}`);
      console.log('💡 Tu peux supprimer le backup si tout est OK');

    } catch (error) {
      console.error('❌ Erreur lors du remplacement du fichier:', error);
      throw error;
    }
  }

  /**
   * Affiche le rapport final
   */
  showReport() {
    const validPercent = (this.stats.validGames / this.stats.totalGames * 100).toFixed(2);
    const invalidPercent = (this.stats.invalidGames / this.stats.totalGames * 100).toFixed(2);

    console.log('\n📊 RAPPORT FINAL');
    console.log('================');
    console.log(`📈 Total parties: ${this.stats.totalGames.toLocaleString()}`);
    console.log(`✅ Parties valides: ${this.stats.validGames.toLocaleString()} (${validPercent}%)`);
    console.log(`❌ Parties invalides: ${this.stats.invalidGames.toLocaleString()} (${invalidPercent}%)`);

    if (this.stats.skippedGames > 0) {
      console.log(`⚠️  Parties ignorées (trop volumineuses): ${this.stats.skippedGames.toLocaleString()}`);
    }

    if (this.stats.invalidGames > 0) {
      console.log('\n🔍 TOP ERREURS:');
      const sortedErrors = Object.entries(this.stats.errors)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

      sortedErrors.forEach(([error, count]) => {
        const percent = (count / this.stats.invalidGames * 100).toFixed(1);
        console.log(`   ${error}: ${count} fois (${percent}%)`);
      });
    }

    console.log('\n📁 FICHIERS GÉNÉRÉS:');
    if (fs.existsSync(this.inputFile)) {
      const cleanedSize = (fs.statSync(this.inputFile).size / 1024 / 1024).toFixed(2);
      console.log(`   🧹 ${this.inputFile} (${cleanedSize} MB) - NETTOYÉ`);
    }
    if (fs.existsSync(this.logFile)) {
      const logSize = (fs.statSync(this.logFile).size / 1024).toFixed(2);
      console.log(`   📄 ${this.logFile} (${logSize} KB) - RAPPORT DÉTAILLÉ`);
    }

    if (this.stats.validGames === this.stats.totalGames) {
      console.log('\n🎉 TOUTES LES PARTIES ÉTAIENT VALIDES !');
    } else {
      console.log('\n✅ FICHIER NETTOYÉ AVEC SUCCÈS');
      console.log(`   ${this.stats.invalidGames} parties invalides supprimées`);
      console.log(`   Détails des erreurs dans: ${this.logFile}`);
    }
  }

  /**
   * Calcule l'ETA basé sur la progression dans le fichier
   */
  calculateETA() {
    if (!this.stats.startTime || this.stats.totalGames === 0) return null;

    const progress = this.stats.processedBytes / this.stats.fileSize;
    if (progress === 0) return null;

    const estimatedTotalGames = this.stats.totalGames / progress;
    const remainingGames = Math.max(0, estimatedTotalGames - this.stats.totalGames);

    if (remainingGames === 0) return null;

    const elapsed = Date.now() - this.stats.startTime;
    const avgTimePerGame = elapsed / this.stats.totalGames;
    const etaMs = remainingGames * avgTimePerGame;

    if (etaMs < 60000) return `${Math.round(etaMs / 1000)}s`;
    if (etaMs < 3600000) return `${Math.round(etaMs / 60000)}min`;
    return `${Math.round(etaMs / 3600000)}h`;
  }

  /**
   * Formate un temps en secondes
   */
  formatTime(seconds) {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m${(seconds % 60).toFixed(0)}s`;
    return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
  }

  /**
   * Point d'entrée principal
   */
  async run() {
    try {
      const stats = fs.statSync(this.inputFile);
      console.log(`📊 Taille: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      await this.checkAllGamesMultithread();

    } catch (error) {
      console.error(`❌ ERREUR: ${error.message}`);
      console.error('Stack:', error.stack);
      process.exit(1);
    }
  }
}

/**
 * Fonction principale pour l'exécution depuis la ligne de commande
 */
async function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.log('❌ ERREUR: Fichier PGN requis');
    console.log('');
    console.log('📖 USAGE:');
    console.log('  node game-checker.js <fichier.pgn>');
    console.log('');
    console.log('📝 EXEMPLES:');
    console.log('  node game-checker.js ./output/chessmont.pgn');
    console.log('  node game-checker.js ./output/twic.pgn');
    console.log('  node game-checker.js C:\\path\\to\\dataset.pgn');
    console.log('');
    console.log('💡 Le fichier doit avoir l\'extension .pgn');
    console.log('🧹 Le fichier sera nettoyé en place (backup créé automatiquement)');
    console.log('📄 Rapport détaillé généré dans: output/game-check-report.txt');
    process.exit(1);
  }

  console.log('🔍 VÉRIFICATION ET NETTOYAGE PGN');
  console.log('=================================');
  console.log(`🎯 Fichier d'entrée: ${inputFile}`);

  try {
    const checker = new GameChecker(inputFile);
    await checker.run();

  } catch (error) {
    console.error(`❌ ERREUR: ${error.message}`);
    process.exit(1);
  }
}


if (process.argv[1] && process.argv[1].endsWith('game-checker.js')) {
  main();
}

export default GameChecker;

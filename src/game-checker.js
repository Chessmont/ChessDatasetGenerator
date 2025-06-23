#!/usr/bin/env node

import fs from 'fs';
import { Worker } from 'worker_threads';
import os from 'os';

class GameChecker {
  constructor() {
    this.inputFile = './scripts/output/chessmont.pgn';
    this.validGamesFile = './scripts/output/chessmont-valid.pgn';
    this.invalidGamesFile = './scripts/output/chessmont-invalid.pgn';
    this.logFile = './scripts/output/game-check-report.txt';    this.numWorkers = os.cpus().length; // Utiliser tous les cores CPU
    this.batchSize = 16; // Batch plus grand pour améliorer l'efficacité
    this.maxQueueSize = this.numWorkers * 4; // Limite de la queue pour éviter l'accumulation en RAM
    this.stats = {
      totalGames: 0,
      validGames: 0,
      invalidGames: 0,
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
    console.log('🔍 VÉRIFICATION DES PARTIES PGN (MULTITHREAD)');
    console.log('===============================================');
    console.log(`📁 Input: ${this.inputFile}`);
    console.log(`✅ Valid: ${this.validGamesFile}`);
    console.log(`❌ Invalid: ${this.invalidGamesFile}`);
    console.log(`📄 Report: ${this.logFile}`);    console.log(`🧵 Workers: ${this.numWorkers}`);
    console.log(`📦 Batch size: ${this.batchSize}`);
    console.log(`🚦 Max queue size: ${this.maxQueueSize}\n`);

    // Supprimer les fichiers de sortie s'ils existent
    [this.validGamesFile, this.invalidGamesFile, this.logFile].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    const validStream = fs.createWriteStream(this.validGamesFile, { encoding: 'utf8' });
    const invalidStream = fs.createWriteStream(this.invalidGamesFile, { encoding: 'utf8' });
    const logStream = fs.createWriteStream(this.logFile, { encoding: 'utf8' });
    
    console.time('⏱️  Vérification totale');
    this.stats.startTime = Date.now();

    // Créer le pool de workers avec système de disponibilité
    const workers = [];
    const workerStates = []; // true = disponible, false = occupé
    const batchQueue = []; // File d'attente des batches
    let isStreamingComplete = false;
    let activeTasks = 0; // Compteur des tâches en cours

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker('./scripts/lib/game-checker-worker.js');
      workers.push(worker);
      workerStates.push(true); // Tous les workers sont disponibles au début
      
      // Configurer les listeners une seule fois par worker
      worker.on('message', (message) => {
        activeTasks--;
        workerStates[i] = true; // Worker devient disponible
        
        if (message.success) {
          this.writeResults(message.result, validStream, invalidStream, logStream);
          
          this.stats.totalGames += message.result.totalGames;
          this.stats.validGames += message.result.validGames;
          this.stats.invalidGames += message.result.invalidGames;
          
          for (const [errorType, count] of Object.entries(message.result.errors)) {
            this.stats.errors[errorType] = (this.stats.errors[errorType] || 0) + count;
          }
            // Affichage log dynamique
          const elapsed = (Date.now() - this.stats.startTime) / 1000;
          const gamesPerSec = (this.stats.totalGames / elapsed).toFixed(1);
          const eta = this.calculateETA();
          const queueInfo = batchQueue.length > 0 ? ` | Queue: ${batchQueue.length}` : '';
          process.stdout.write(`\r🔍 ${this.stats.totalGames.toLocaleString()} parties | ${this.stats.invalidGames} erreurs | ${this.formatTime(elapsed)} | ${gamesPerSec}/s${eta ? ` | ETA ${eta}` : ''}${queueInfo}`);
        } else {
          console.error(`\nWorker ${i} error:`, message.error);
        }
        
        // Traiter le prochain batch disponible
        processNextBatch();
      });
      
      worker.on('error', (error) => {
        activeTasks--;
        workerStates[i] = true;
        console.error(`\nWorker ${i} crashed:`, error);
        processNextBatch();
      });
    }    // Fonction pour traiter le prochain batch avec un worker disponible
    const processNextBatch = () => {
      // Trouver un worker disponible
      const availableWorkerIndex = workerStates.findIndex(state => state === true);
      
      if (availableWorkerIndex === -1 || batchQueue.length === 0) {
        // Pas de worker dispo ou pas de batch en attente
        if (isStreamingComplete && activeTasks === 0 && batchQueue.length === 0) {
          // Traitement terminé
          finishProcessing();
        }
        return;
      }
      
      const batch = batchQueue.shift();
      const worker = workers[availableWorkerIndex];
      
      workerStates[availableWorkerIndex] = false; // Worker devient occupé
      activeTasks++;
      
      worker.postMessage({ batch, batchId: Math.random().toString(36) });
      
      // Backpressure: reprendre le stream si la queue n'est plus pleine
      if (streamPaused && batchQueue.length < this.maxQueueSize / 2) {
        streamPaused = false;
        stream.resume();
      }
    };

    // Fonction appelée quand tout est terminé
    const finishProcessing = () => {
      workers.forEach(worker => worker.terminate());
      validStream.end();
      invalidStream.end();
      logStream.end();
      
      console.log(`\n🎯 Traitement terminé: ${this.stats.totalGames.toLocaleString()} parties testées | ${this.stats.invalidGames} erreurs`);
      console.timeEnd('⏱️  Vérification totale');
      this.showReport();
    };    // Streaming du fichier
    const READ_CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    const stats = fs.statSync(this.inputFile);
    const fileSize = stats.size;
    this.stats.fileSize = fileSize;

    const stream = fs.createReadStream(this.inputFile, { encoding: 'utf8', highWaterMark: READ_CHUNK_SIZE });
    
    let buffer = '';
    let currentGame = '';
    let inGame = false;
    let currentBatch = [];
    let processedBytes = 0;
    let streamPaused = false; // Flag pour gérer le backpressure

    stream.on('data', (chunk) => {
      processedBytes += Buffer.byteLength(chunk, 'utf8');
      this.stats.processedBytes = processedBytes;
      
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Garder la ligne incomplète

      for (const line of lines) {
        if (line.startsWith('[ID ')) {
          // Finir la partie précédente
          if (inGame && currentGame.trim()) {
            currentBatch.push(currentGame);
              // Si le batch est plein, l'ajouter à la queue
            if (currentBatch.length >= this.batchSize) {
              batchQueue.push([...currentBatch]);
              currentBatch = [];
              
              // Backpressure: pauser le stream si la queue est trop pleine
              if (!streamPaused && batchQueue.length >= this.maxQueueSize) {
                streamPaused = true;
                stream.pause();
              }
              
              // Essayer de traiter des batches
              processNextBatch();
            }
          }

          currentGame = line + '\n';
          inGame = true;
        } else {
          currentGame += line + '\n';
        }
      }
    });

    stream.on('end', () => {
      // Traiter les restes
      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith('[ID ')) {
          if (inGame && currentGame.trim()) {
            currentBatch.push(currentGame);
          }
          currentGame = line + '\n';
          inGame = true;
        } else {
          currentGame += line + '\n';
        }
      }

      if (inGame && currentGame.trim()) {
        currentBatch.push(currentGame);
      }

      // Ajouter le dernier batch s'il y en a un
      if (currentBatch.length > 0) {
        batchQueue.push(currentBatch);
      }

      isStreamingComplete = true;
      
      // Essayer de traiter des batches
      processNextBatch();
    });

    stream.on('error', (error) => {
      console.error('❌ Erreur de lecture du fichier:', error);
      workers.forEach(worker => worker.terminate());
      process.exit(1);
    });
  }
  
  /**
   * Écrit les résultats des workers (mode multithread)
   */
  writeResults(result, validStream, invalidStream, logStream) {
    for (const gameText of result.validResults) {
      validStream.write(gameText);
    }

    for (const invalid of result.invalidResults) {
      invalidStream.write(invalid.gameText);

      logStream.write(`❌ INVALID GAME\n`);
      logStream.write(`   Error: ${invalid.error}\n\n`);
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
    if (fs.existsSync(this.validGamesFile)) {
      const validSize = (fs.statSync(this.validGamesFile).size / 1024 / 1024).toFixed(2);
      console.log(`   ✅ ${this.validGamesFile} (${validSize} MB)`);
    }
    if (fs.existsSync(this.invalidGamesFile)) {
      const invalidSize = (fs.statSync(this.invalidGamesFile).size / 1024 / 1024).toFixed(2);
      console.log(`   ❌ ${this.invalidGamesFile} (${invalidSize} MB)`);
    }
    console.log(`   📄 ${this.logFile}`);

    if (this.stats.validGames === this.stats.totalGames) {
      console.log('\n🎉 TOUTES LES PARTIES SONT VALIDES !');
    } else {
      console.log('\n⚠️  CERTAINES PARTIES SONT INVALIDES');
      console.log(`   Commande: cp ${this.validGamesFile} ${this.inputFile}`);
    }
  }
  /**
   * Calcule l'ETA basé sur la progression dans le fichier
   */
  calculateETA() {
    if (!this.stats.startTime || this.stats.totalGames === 0) return null;

    // Estimer les parties totales basé sur la position dans le fichier
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
   * Formate un temps en secondes en format HH:MM:SS
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
      if (!fs.existsSync(this.inputFile)) {
        throw new Error(`Fichier d'entrée non trouvé: ${this.inputFile}`);
      }

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

// Exécution
const checker = new GameChecker();
checker.run();

export default GameChecker;

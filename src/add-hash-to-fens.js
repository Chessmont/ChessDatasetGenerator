#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AddHashProcessor {
  constructor() {
    this.inputFile = path.join(__dirname, 'output', 'fens-all.tsv');
    this.outputFile = path.join(__dirname, 'output', 'fens-all-hashed.tsv');

    this.numWorkers = os.cpus().length;
    this.batchSize = 16;
    this.maxQueueSize = this.numWorkers * 4;

    this.totalLines = 0;
    this.processedLines = 0;
    this.startTime = null;
    this.lastLogTime = 0;
  }

  async countTotalLines() {
    console.log(`🔍 Comptage des lignes dans ${this.inputFile}...`);

    return new Promise((resolve, reject) => {
      let lineCount = 0;
      const stream = fs.createReadStream(this.inputFile, { encoding: 'utf8' });
      const { createInterface } = require('readline');
      const rl = createInterface({ input: stream });

      rl.on('line', () => lineCount++);
      rl.on('close', () => {
        this.totalLines = Math.max(0, lineCount - 1);
        console.log(`📊 ${this.totalLines.toLocaleString()} positions trouvées\n`);
        resolve(this.totalLines);
      });
      rl.on('error', reject);
    });
  }

  async processFile() {
    console.log('🚀 AJOUT DE HASH AUX POSITIONS FEN');
    console.log('==========================================');
    console.log(`📁 Input: ${this.inputFile}`);
    console.log(`📄 Output: ${this.outputFile}`);
    console.log(`🧵 Workers: ${this.numWorkers}`);
    console.log(`📦 Batch size: ${this.batchSize}`);
    console.log(`🚦 Max queue size: ${this.maxQueueSize}\n`);

    console.time('⏱️  Ajout de hash');
    this.startTime = Date.now();

    const outputStream = fs.createWriteStream(this.outputFile, { encoding: 'utf8' });
    outputStream.write('hash\tfen\toccurrence\twhite\tblack\tdraw\n');

    const workers = [];
    const workerStates = [];
    const batchQueue = [];
    let isStreamingComplete = false;
    let activeTasks = 0;

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(path.join(__dirname, 'lib', 'hash-fens-worker.js'));
      workers.push(worker);
      workerStates.push(true);

      worker.on('message', (message) => {
        activeTasks--;
        workerStates[i] = true;

        if (message.success) {
          for (const line of message.result.lines) {
            outputStream.write(line + '\n');
          }

          this.processedLines += message.result.processedCount;
          this.updateProgressLog();
        } else {
          console.error(`\nWorker ${i} error:`, message.error);
        }

        processNextBatch();
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

      worker.postMessage({
        lines: batch,
        batchId: Math.random().toString(36)
      });

      if (streamPaused && batchQueue.length < this.maxQueueSize / 2) {
        streamPaused = false;
        stream.resume();
      }
    };

    let promiseResolve = null;

    const finishProcessing = () => {
      workers.forEach(worker => worker.terminate());
      outputStream.end();

      console.log();
      console.timeEnd('⏱️  Ajout de hash');
      console.log(`✅ Lignes traitées: ${this.processedLines.toLocaleString()}/${this.totalLines.toLocaleString()}`);
      console.log(`📄 Fichier final créé: ${this.outputFile}`);

      if (promiseResolve) {
        promiseResolve();
      }
    };

    const READ_CHUNK_SIZE = 1024 * 1024;
    const stream = fs.createReadStream(this.inputFile, {
      encoding: 'utf8',
      highWaterMark: READ_CHUNK_SIZE
    });

    let buffer = '';
    let currentBatch = [];
    let streamPaused = false;
    let isFirstLine = true;

    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (isFirstLine) {
          isFirstLine = false;
          continue;
        }

        if (line.trim()) {
          currentBatch.push(line);

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
      }
    });

    stream.on('end', () => {
      if (buffer.trim() && !isFirstLine) {
        currentBatch.push(buffer.trim());
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
      throw error;
    });

    return new Promise((resolve, reject) => {
      promiseResolve = resolve;
      stream.on('error', reject);
    });
  }

  updateProgressLog() {
    const now = Date.now();

    if (now - this.lastLogTime < 500) return;
    this.lastLogTime = now;

    const percentage = this.totalLines > 0 ? ((this.processedLines / this.totalLines) * 100).toFixed(1) : '0.0';
    const elapsed = (now - this.startTime) / 1000;
    const avgTime = elapsed / this.processedLines;
    const remaining = this.totalLines - this.processedLines;
    const eta = avgTime * remaining;

    const elapsedStr = this.formatTime(elapsed);
    const etaStr = this.formatTime(eta);

    const logLine = `\r🚀 Hash: ${this.processedLines.toLocaleString()}/${this.totalLines.toLocaleString()} (${percentage}%) - ⏱️ ${elapsedStr} / ETA ${etaStr}`;

    process.stdout.write(logLine);
  }

  formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.round(seconds % 60);
      return `${minutes}min${remainingSeconds}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const remainingMinutes = Math.round((seconds % 3600) / 60);
    return `${hours}h${remainingMinutes}min`;
  }

  async run() {
    console.log('🚀 Hash Processor - Ajout de cityHash64');
    console.log('=========================================');
    console.log(`📁 Input: ${this.inputFile}`);
    console.log(`📁 Output: ${this.outputFile}`);
    console.log(`🧵 Workers: ${this.numWorkers} cores\n`);

    console.time('⏱️  Traitement complet');

    try {
      await this.countTotalLines();
      await this.processFile();

      console.timeEnd('⏱️  Traitement complet');
      console.log('\n✅ Traitement complet terminé avec succès !');
    } catch (error) {
      console.error('\n❌ Erreur:', error.message);
      console.error('Stack:', error.stack);
      throw error;
    }
  }
}

const processor = new AddHashProcessor();
processor.run().catch((error) => {
  console.error('\n💥 CRASH PRINCIPAL:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * Pool de workers pour exécuter les merges K-way en parallèle
 */
class MergeWorkerPool {
  constructor(maxWorkers = 4) {
    this.maxWorkers = maxWorkers;
    this.activeWorkers = new Set();
    this.queue = [];

    this.workerPath = path.join(process.cwd(), 'lib', 'merge-worker.js');
  }

  /**
   * Execute un merge K-way dans un worker thread séparé
   */
  async executeMerge(inputFiles, outputFile, isFirstPhase = false) {
    return new Promise((resolve, reject) => {

      if (this.activeWorkers.size >= this.maxWorkers) {
        this.queue.push({ inputFiles, outputFile, isFirstPhase, resolve, reject });
        return;
      }

      this._startWorker(inputFiles, outputFile, isFirstPhase, resolve, reject);
    });
  }

  _startWorker(inputFiles, outputFile, isFirstPhase, resolve, reject) {
    const worker = new Worker(this.workerPath);
    this.activeWorkers.add(worker);


    worker.on('message', (result) => {
      this._onWorkerComplete(worker, result, null, resolve, reject);
    });

    worker.on('error', (error) => {
      this._onWorkerComplete(worker, null, error, resolve, reject);
    });


    worker.postMessage({
      inputFiles,
      outputFile,
      isFirstPhase
    });
  }

  _onWorkerComplete(worker, result, error, resolve, reject) {

    this.activeWorkers.delete(worker);
    worker.terminate();


    if (error) {
      reject(error);
    } else {
      resolve(result);
    }


    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this._startWorker(next.inputFiles, next.outputFile, next.isFirstPhase, next.resolve, next.reject);
    }
  }

  /**
   * Attendre que tous les workers se terminent
   */
  async waitForCompletion() {
    while (this.activeWorkers.size > 0 || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Arrêter tous les workers
   */
  async shutdown() {
    for (const worker of this.activeWorkers) {
      await worker.terminate();
    }
    this.activeWorkers.clear();
    this.queue.length = 0;
  }
}

class FenProcessor {
  constructor() {

    const inputFileName = config.withOnlineGame ? config.finalPGNFileName : config.officialPGNFileName;
    this.inputFile = path.join(__dirname, 'output', inputFileName);


    const baseFileName = inputFileName.replace('.pgn', '');
    this.positionIndexFile = path.join(__dirname, 'output', `${baseFileName}-pgi.tsv`);

    this.tempDir = path.join(__dirname, '..', 'src/temp');
    this.outputDir = path.join(__dirname, 'output');


    this.numWorkers = os.cpus().length;
    this.batchSize = 16;
    this.maxQueueSize = this.numWorkers * 4;
    this.chunkSize = 3000000;
    this.chunkIndex = 0;
    this.positionsInCurrentChunk = 0;

    this.chunksPerMerge = 6;


    const maxMergeWorkers = os.cpus().length
    this.mergeWorkerPool = new MergeWorkerPool(maxMergeWorkers);
    console.log(`🧵 Pool de merge workers initialisé avec ${maxMergeWorkers} workers`);

    this.totalGames = 0;
    this.positionsProcessed = 0;
    this.gamesProcessedCount = 0;
    this.startTime = null;
    this.fileSize = 0;
    this.processedBytes = 0;
    this.lastLogTime = 0;


    this.resumeMode = process.argv.includes('--resume');
    process.setMaxListeners(0);


    this.chunkWriteStream = null;
    this.indexWriteStream = null;
  }

  /**
   * Compte le nombre total de parties (optimisé depuis game-checker)
   */
  async countTotalGames() {
    console.log(`🔍 Comptage rapide des parties dans ${this.inputFile}...`);

    // const fd = fs.openSync(this.inputFile, 'r');
    // const stats = fs.statSync(this.inputFile);
    // const fileSize = stats.size;
    // this.fileSize = fileSize;

    // console.log(`📊 Taille du fichier: ${(fileSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

    // let buffer = '';
    // let position = 0;
    // let gameCount = 0;
    // const SCAN_CHUNK_SIZE = 8 * 1024 * 1024;

    // while (position < fileSize) {
    //   const readBuffer = Buffer.alloc(Math.min(SCAN_CHUNK_SIZE, fileSize - position));
    //   const bytesRead = fs.readSync(fd, readBuffer, 0, readBuffer.length, position);

    //   if (bytesRead === 0) break;

    //   buffer += readBuffer.toString('utf8', 0, bytesRead);
    //   position += bytesRead;

    //   const lines = buffer.split('\n');
    //   buffer = lines.pop() || '';

    //   for (const line of lines) {
    //     if (line.startsWith('[ID ')) {
    //       gameCount++;
    //     }
    //   }

    //   if (gameCount % 100000 === 0 && gameCount > 0) {
    //     const progress = (position / fileSize * 100).toFixed(1);
    //     process.stdout.write(`\r🔍 Scan: ${gameCount.toLocaleString()} parties trouvées (${progress}%)`);
    //   }
    // }

    // fs.closeSync(fd);

    this.totalGames = 21512376;
    console.log(`\n📊 ${this.totalGames.toLocaleString()} parties trouvées dans le fichier`);

    const estimatedPositions = Math.round(this.totalGames * 87.67);
    const estimatedChunks = Math.ceil(estimatedPositions / this.chunkSize);

    console.log(`📈 Estimation : ${estimatedPositions.toLocaleString()} positions → ${estimatedChunks} chunks`);

    return this.totalGames;
  }

  /**
   * Initialise un nouveau chunk de sortie
   */
  initChunk() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }


    const chunkFile = path.join(this.tempDir, `chunk_${this.chunkIndex}.tmp`);
    this.chunkWriteStream = fs.createWriteStream(chunkFile, { encoding: 'utf8' });


    if (!this.indexWriteStream) {
      const outputDir = path.dirname(this.positionIndexFile);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      this.indexWriteStream = fs.createWriteStream(this.positionIndexFile, { encoding: 'utf8' });
      this.indexWriteStream.write('fen\tgame_id\n');
    }

    this.positionsInCurrentChunk = 0;
  }

  /**
   * Écrit les positions dans les chunks avec rotation
   */
  writePositionsToChunk(positions) {
    for (const position of positions) {

      if (this.positionsInCurrentChunk >= this.chunkSize) {
        this.chunkWriteStream.end();
        this.chunkIndex++;
        this.initChunk();
      }


      const line = `${position.fen}|${position.result}\n`;
      this.chunkWriteStream.write(line);


      if (position.gameId) {
        const indexLine = `${position.fen}\t${position.gameId}\n`;
        this.indexWriteStream.write(indexLine);
      }

      this.positionsInCurrentChunk++;
      this.positionsProcessed++;
    }
  }

  /**
   * EXTRACTION PGN AVEC MULTITHREAD (basé sur game-checker)
   */
  async processPgnFileMultithread() {
    console.log('🚀 EXTRACTION POSITIONS FEN (MULTITHREAD)');
    console.log('==========================================');
    console.log(`📁 Input: ${this.inputFile}`);
    console.log(`📄 Output chunks: ${this.tempDir}`);
    console.log(`🎯 Index: ${this.positionIndexFile}`);
    console.log(`🧵 Workers: ${this.numWorkers}`);
    console.log(`📦 Batch size: ${this.batchSize}`);
    console.log(`🚦 Max queue size: ${this.maxQueueSize}`);
    console.log(`🔢 Chunk size: ${this.chunkSize.toLocaleString()} positions\n`);

    console.time('⏱️  Extraction PGN');
    this.startTime = Date.now();

    this.initChunk();


    const workers = [];
    const workerStates = [];
    const batchQueue = [];
    let isStreamingComplete = false;
    let activeTasks = 0; for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker('./lib/fen-worker.js');
      workers.push(worker);
      workerStates.push(true);

      worker.on('message', (message) => {
        activeTasks--;
        workerStates[i] = true;

        if (message.success) {

          this.writePositionsToChunk(message.result.positions);

          this.gamesProcessedCount += message.result.processedGames;


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
        games: batch,
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

      if (this.chunkWriteStream) {
        this.chunkWriteStream.end();
      }
      if (this.indexWriteStream) {
        this.indexWriteStream.end();
      }

      console.log();
      console.timeEnd('⏱️  Extraction PGN');
      console.log(`✅ Parties traitées: ${this.gamesProcessedCount.toLocaleString()}/${this.totalGames.toLocaleString()}`);
      console.log(`📝 ${this.positionsProcessed.toLocaleString()} positions extraites dans ${this.chunkIndex + 1} chunks`);
      console.log(`🎯 Index final créé: ${this.positionIndexFile}`);


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
    let currentGame = '';
    let inGame = false;
    let currentBatch = [];
    let processedBytes = 0;
    let streamPaused = false;

    stream.on('data', (chunk) => {
      processedBytes += Buffer.byteLength(chunk, 'utf8');
      this.processedBytes = processedBytes;

      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('[ID ')) {

          if (inGame && currentGame.trim()) {
            currentBatch.push(currentGame);

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
          currentGame += line + '\n';
        }
      }
    });

    stream.on('end', () => {

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

  /**
   * Met à jour le log de progression
   */
  updateProgressLog() {
    const now = Date.now();

    if (now - this.lastLogTime < 500) return;
    this.lastLogTime = now;

    const percentage = this.totalGames > 0 ? ((this.gamesProcessedCount / this.totalGames) * 100).toFixed(1) : '0.0';
    const elapsed = (now - this.startTime) / 1000;
    const avgTime = elapsed / this.gamesProcessedCount;
    const remaining = this.totalGames - this.gamesProcessedCount;
    const eta = avgTime * remaining;

    const elapsedStr = this.formatTime(elapsed);
    const etaStr = this.formatTime(eta);

    const logLine = `\r🚀 Extraction: ${this.gamesProcessedCount.toLocaleString()}/${this.totalGames.toLocaleString()} (${percentage}%) - ${this.positionsProcessed.toLocaleString()} positions - ⏱️ ${elapsedStr} / ETA ${etaStr}`;

    process.stdout.write(logLine);
  }
  /**
   * Formate un temps en secondes
   */
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

  /**
   * Traite un chunk : TRI ALPHABÉTIQUE OPTIMISÉ MÉMOIRE
   */

  async processSingleChunk(chunkFile) {
    return new Promise(async (resolve, reject) => {
      const sortedFile = chunkFile.replace('.tmp', '_sorted.tmp');

      const { createInterface } = await import('readline');
      const readStream = fs.createReadStream(chunkFile, { encoding: 'utf8' });
      const rl = createInterface({ input: readStream });

      const lines = [];
      let lineCount = 0;

      rl.on('line', (line) => {
        if (line.trim()) {
          lines.push(line);
          lineCount++;
        }
      });

      rl.on('close', () => {
        try {


          lines.sort((a, b) => {
            const fenA = a.split('|')[0];
            const fenB = b.split('|')[0];
            return fenA.localeCompare(fenB);
          });
          const writeStream = fs.createWriteStream(sortedFile, { encoding: 'utf8' });

          for (const line of lines) {
            writeStream.write(line + '\n');
          }

          writeStream.end();
          writeStream.on('finish', () => {
            fs.unlinkSync(chunkFile);
            resolve(sortedFile);
          });

        } catch (error) {
          console.error(`     ❌ Erreur lors du tri de ${path.basename(chunkFile)}:`, error.message);
          reject(error);
        }
      });

      rl.on('error', reject);
      readStream.on('error', reject);
    });
  }

  /**
   * Traite tous les chunks en parallèle pour les trier
   */
  async processAllChunks() {
    console.log(`\n🔄 Tri des chunks...`);
    console.time('⏱️  Tri des chunks');

    if (!fs.existsSync(this.tempDir)) {
      throw new Error(`Dossier temporaire non trouvé: ${this.tempDir}`);
    }
    const chunkFiles = fs.readdirSync(this.tempDir)
      .filter(file => file.startsWith('chunk_') && file.endsWith('.tmp') && !file.includes('_sorted'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/chunk_(\d+)\.tmp/)?.[1] || 0);
        const numB = parseInt(b.match(/chunk_(\d+)\.tmp/)?.[1] || 0);
        return numA - numB;
      })
      .map(file => path.join(this.tempDir, file));

    console.log(`📂 ${chunkFiles.length} chunks trouvés`);

    const sortedFiles = [];

    for (let i = 0; i < chunkFiles.length; i += Math.min(this.numWorkers, 32)) {
      const batch = chunkFiles.slice(i, i + Math.min(this.numWorkers, 32));
      const batchResults = await Promise.all(
        batch.map(chunkFile => this.processSingleChunk(chunkFile))
      );
      sortedFiles.push(...batchResults);

      if (global.gc) {
        global.gc();
        console.log(`   🧹 GC forcé après batch ${Math.floor(i / this.numWorkers) + 1}/${Math.ceil(chunkFiles.length / this.numWorkers)}`);
      }
      process.stdout.write(`\r🔄 Tri des chunks: ${Math.min(i + this.numWorkers, chunkFiles.length).toLocaleString()}/${chunkFiles.length.toLocaleString()} chunks traités...`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.timeEnd('⏱️  Tri des chunks');
    console.log(`✅ ${sortedFiles.length} chunks triés`);

    return sortedFiles;
  }

  /**
   * Système multi-phases de K-way merge avec réduction progressive
   */
   async multiPhaseKWayMerge(sortedFiles, keepSortedFiles = true) {
    console.log(`\n🚀 DÉBUT DU SYSTÈME MULTI-PHASES DE K-WAY MERGE AVEC WORKERS`);
    console.log(`📊 Input initial: ${sortedFiles.length} chunks triés`);
    console.log(`🛡️  Conservation des fichiers _sorted: ${keepSortedFiles ? 'OUI' : 'NON'}`);
    console.log(`🧵 Workers de merge parallèles: ${this.mergeWorkerPool.maxWorkers}`);
    console.time('⏱️  K-way merge multi-phases avec workers');

    let currentFiles = [...sortedFiles];
    let phaseNumber = 1;

    // FORCER LA PHASE 1 pour convertir le format fen|result vers fen\toccurrence\twhite\tblack\tdraw
    // même si on a peu de fichiers
    const mustRunPhase1 = true;

    while (currentFiles.length > this.chunksPerMerge || (phaseNumber === 1 && mustRunPhase1)) {
      console.log(`\n🔄 === PHASE ${phaseNumber} ===`);
      console.log(`📂 Input: ${currentFiles.length} chunks`);

      const phaseDir = path.join(this.tempDir, `phase${phaseNumber}`);
      if (!fs.existsSync(phaseDir)) {
        fs.mkdirSync(phaseDir, { recursive: true });
      }

      const nextPhaseFiles = [];
      let mergeIndex = 0;


      const mergeTasks = [];
      for (let i = 0; i < currentFiles.length; i += this.chunksPerMerge) {
        const batch = currentFiles.slice(i, i + this.chunksPerMerge);
        const outputFile = path.join(phaseDir, `chunk_${mergeIndex}.tmp`);

        mergeTasks.push({
          batch,
          outputFile,
          mergeIndex,
          isFirstPhase: phaseNumber === 1
        });

        mergeIndex++;
      }

      console.log(`🧵 Lancement de ${mergeTasks.length} merges en parallèle via workers...`);
      const mergePromises = mergeTasks.map(async (task) => {
        const startTime = Date.now();
        const result = await this.mergeWorkerPool.executeMerge(
          task.batch,
          task.outputFile,
          task.isFirstPhase
        );


        if (!result.success) {
          throw new Error(`Worker merge failed: ${result.error}`);
        }

        const duration = Date.now() - startTime;

        console.log(`   ✅ Merge batch ${task.mergeIndex}: ${task.batch.length} fichiers → ${result.positionsWritten.toLocaleString()} positions (${(duration/1000).toFixed(1)}s) [Worker ${result.workerId}]`);

        return task.outputFile;
      });


      const completedFiles = await Promise.all(mergePromises);
      nextPhaseFiles.push(...completedFiles);


      if (phaseNumber === 1 && keepSortedFiles) {
        console.log(`   🛡️  Conservation des fichiers _sorted activée - pas de suppression pour cette phase`);
      } else {
        for (const file of currentFiles) {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
          }
        }
      }

      console.log(`✅ Phase ${phaseNumber} terminée: ${currentFiles.length} → ${nextPhaseFiles.length} chunks`);

      currentFiles = nextPhaseFiles;
      phaseNumber++;
    }

    console.log(`\n🏁 === PHASE FINALE ===`);

    const finalResult = await this.kWayMergeFinal(currentFiles);


    for (const file of currentFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    console.log(`🎯 Système multi-phases terminé: ${phaseNumber - 1} phases utilisées`);

    console.timeEnd('⏱️  K-way merge multi-phases avec workers');
    return finalResult;
  }

  /**
   * K-way merge final vers fichiers partitionnés (phase finale uniquement)
   */
  async kWayMergeFinal(inputFiles) {
    let positionsWritten = 0;

    try {
      console.log(`🔄 K-way merge final de ${inputFiles.length} fichiers vers partitions...`);

      const partitionStreams = {};
      for (let i = 1; i <= 9; i++) {
        const partitionFile = path.join(this.tempDir, `${i}occ.tmp`);
        partitionStreams[i] = fs.createWriteStream(partitionFile, { encoding: 'utf8' });
      }
      const partitionFile10Plus = path.join(this.tempDir, '10plusocc.tmp');
      partitionStreams['10plus'] = fs.createWriteStream(partitionFile10Plus, { encoding: 'utf8' });

      const readers = inputFiles.map((file, index) => {
        const readStream = fs.createReadStream(file, {
          encoding: 'utf8',
          highWaterMark: 2 * 1024 * 1024
        });
        return {
          file,
          index,
          readStream,
          buffer: '',
          currentLine: null,
          finished: false,
          streamEnded: false
        };
      });

      for (const reader of readers) {
        await this.readNextLine(reader);
      }

      let currentFen = null;
      let currentStats = { occurrence: 0, white: 0, black: 0, draw: 0 };

      let totalLinesProcessed = 0;
      let mergeStartTime = Date.now();
      let lastProgressLog = Date.now();

      while (readers.some(r => !r.finished)) {

        const now = Date.now();
        if (now - lastProgressLog > 2000) {
          const elapsed = (now - mergeStartTime) / 1000;
          const elapsedStr = this.formatTime(elapsed);
          process.stdout.write(`\r🔄 Merge final: ${totalLinesProcessed.toLocaleString()} lignes → ${positionsWritten.toLocaleString()} uniques - ⏱️ ${elapsedStr}`);
          lastProgressLog = now;
        }

        const currentPositions = [];
        for (const reader of readers) {
          if (!reader.finished && reader.currentLine) {
            const parts = reader.currentLine.split('\t');
            if (parts.length >= 5) {
              const fen = parts[0];
              currentPositions.push({ fen, reader });
            }
          }
        }

        if (currentPositions.length === 0) break;

        currentPositions.sort((a, b) => a.fen.localeCompare(b.fen));
        const minFen = currentPositions[0].fen;
        const minReaders = currentPositions.filter(pos => pos.fen === minFen).map(pos => pos.reader);

        if (currentFen !== null && currentFen !== minFen) {
          const line = `${currentFen}\t${currentStats.occurrence}\t${currentStats.white}\t${currentStats.black}\t${currentStats.draw}\n`;

          if (currentStats.occurrence >= 10) {
            partitionStreams['10plus'].write(line);
          } else {
            partitionStreams[currentStats.occurrence].write(line);
          }

          positionsWritten++;
          currentStats = { occurrence: 0, white: 0, black: 0, draw: 0 };
        }

        currentFen = minFen;

        for (const reader of minReaders) {
          const parts = reader.currentLine.split('\t');
          totalLinesProcessed++;


          currentStats.occurrence += parseInt(parts[1]) || 0;
          currentStats.white += parseInt(parts[2]) || 0;
          currentStats.black += parseInt(parts[3]) || 0;
          currentStats.draw += parseInt(parts[4]) || 0;

          await this.readNextLine(reader);
          if (!reader.currentLine && reader.streamEnded) {
            reader.finished = true;
          }
        }
      }

      if (currentFen !== null) {
        const line = `${currentFen}\t${currentStats.occurrence}\t${currentStats.white}\t${currentStats.black}\t${currentStats.draw}\n`;

        if (currentStats.occurrence >= 10) {
          partitionStreams['10plus'].write(line);
        } else {
          partitionStreams[currentStats.occurrence].write(line);
        }

        positionsWritten++;
      }

      for (const reader of readers) {
        reader.readStream.destroy();
      }

      for (const stream of Object.values(partitionStreams)) {
        stream.end();
      }
      await Promise.all(Object.values(partitionStreams).map(stream =>
        new Promise(resolve => stream.on('finish', resolve))
      ));

      const finalElapsed = (Date.now() - mergeStartTime) / 1000;
      const finalElapsedStr = this.formatTime(finalElapsed);
      console.log(`\n✅ K-way merge final terminé: ${totalLinesProcessed.toLocaleString()} lignes → ${positionsWritten.toLocaleString()} positions uniques en ${finalElapsedStr}`);

    } catch (error) {
      console.error('❌ Erreur lors du K-way merge final:', error.message);
      console.error('Stack:', error.stack);
      throw error;
    }

    return { positionsWritten };
  }

  /**
   * Calcule les statistiques finales
   */
  async calculateFinalStats() {
    const { createInterface } = await import('readline');

    const countLines = async (filePath) => {
      if (!fs.existsSync(filePath)) return 0;

      return new Promise((resolve, reject) => {
        let lineCount = 0;
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = createInterface({ input: stream });

        rl.on('line', () => lineCount++);
        rl.on('close', () => resolve(Math.max(0, lineCount - 1)));
        rl.on('error', reject);
      });
    };

    const fensAllFile = path.join(this.outputDir, 'fens-all.tsv');
    const fensWithoutOneFile = path.join(this.outputDir, 'fens-withoutone.tsv');
    const fensOnlyRecurrentFile = path.join(this.outputDir, 'fens-onlyrecurrent.tsv');

    const [allCount, withoutOneCount, onlyRecurrentCount] = await Promise.all([
      countLines(fensAllFile),
      countLines(fensWithoutOneFile),
      countLines(fensOnlyRecurrentFile)
    ]);

    return { allCount, withoutOneCount, onlyRecurrentCount };
  }

  /**
   * Lit la ligne suivante d'un lecteur avec gestion robuste des fins de fichier
   */
  async readNextLine(reader) {
    return new Promise((resolve) => {
      if (reader.finished) {
        resolve();
        return;
      }

      const processBuffer = () => {

        const newlineIndex = reader.buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          const rawLine = reader.buffer.slice(0, newlineIndex);
          reader.currentLine = rawLine.trim();
          reader.buffer = reader.buffer.slice(newlineIndex + 1);


          if (reader.currentLine) {
            reader.linesRead = (reader.linesRead || 0) + 1;
            resolve();
            return true;
          }

          return false;
        }
        return false;
      };

      const tryReadMore = () => {
        if (!reader.readStream.readable || reader.readStream.destroyed || reader.streamEnded) {

          reader.streamEnded = true;
          if (reader.buffer.length > 0) {
            const remainingData = reader.buffer.trim();
            if (remainingData) {
              reader.currentLine = remainingData;
              reader.buffer = '';
              reader.linesRead = (reader.linesRead || 0) + 1;
              resolve();
              return;
            }
          }

          reader.currentLine = null;
          reader.finished = true;
          resolve();
          return;
        }


        const chunk = reader.readStream.read();
        if (chunk) {
          reader.buffer += chunk;

          while (processBuffer()) {
            return;
          }

          setImmediate(tryReadMore);
        } else {

          const onReadable = () => {
            reader.readStream.removeListener('readable', onReadable);
            reader.readStream.removeListener('end', onEnd);
            if (!reader.finished) {
              tryReadMore();
            }
          };
          const onEnd = () => {
            reader.readStream.removeListener('readable', onReadable);
            reader.readStream.removeListener('end', onEnd);
            reader.streamEnded = true;
            tryReadMore();
          };

          reader.readStream.once('readable', onReadable);
          reader.readStream.once('end', onEnd);
        }
      };


      while (processBuffer()) {
        return;
      }


      tryReadMore();
    });
  }

  /**
   * Lit plusieurs lignes d'un coup pour optimiser les performances I/O du K-way merge
   */
  async readNextLineBatch(reader, batchSize = 50) {
    return new Promise((resolve) => {
      if (reader.finished) {
        resolve();
        return;
      }

      const processBuffer = () => {
        let linesFound = 0;
        const targetLines = Math.max(1, batchSize - reader.lineQueue.length);

        while (linesFound < targetLines) {
          const newlineIndex = reader.buffer.indexOf('\n');
          if (newlineIndex === -1) break;

          const rawLine = reader.buffer.slice(0, newlineIndex);
          const trimmedLine = rawLine.trim();
          reader.buffer = reader.buffer.slice(newlineIndex + 1);

          if (trimmedLine) {
            reader.lineQueue.push(trimmedLine);
            linesFound++;
          }
        }

        return linesFound;
      };

      const tryReadMore = () => {
        if (!reader.readStream.readable || reader.readStream.destroyed || reader.streamEnded) {
          reader.streamEnded = true;


          if (reader.buffer.length > 0) {
            const remainingData = reader.buffer.trim();
            if (remainingData) {
              reader.lineQueue.push(remainingData);
              reader.buffer = '';
            }
          }

          if (reader.lineQueue.length === 0) {
            reader.finished = true;
          }

          resolve();
          return;
        }


        let totalData = '';
        let chunk;
        let chunksRead = 0;

        while ((chunk = reader.readStream.read()) !== null && chunksRead < 4) {
          totalData += chunk;
          chunksRead++;

          if (totalData.length > 16 * 1024 * 1024) break;
        }

        if (totalData) {
          reader.buffer += totalData;

          const linesFound = processBuffer();
          if (reader.lineQueue.length >= batchSize || reader.lineQueue.length > 0) {
            resolve();
            return;
          }


          setImmediate(tryReadMore);
        } else {

          const onReadable = () => {
            reader.readStream.removeListener('readable', onReadable);
            reader.readStream.removeListener('end', onEnd);
            if (!reader.finished) {
              tryReadMore();
            }
          };

          const onEnd = () => {
            reader.readStream.removeListener('readable', onReadable);
            reader.readStream.removeListener('end', onEnd);
            reader.streamEnded = true;
            tryReadMore();
          };

          reader.readStream.once('readable', onReadable);
          reader.readStream.once('end', onEnd);
        }
      };


      const existingLines = processBuffer();
      if (reader.lineQueue.length >= batchSize) {
        resolve();
        return;
      }

      tryReadMore();
    });
  }

  /**
   * FONCTION DANGEREUSE - Ne pas utiliser sans confirmation explicite !
   * Supprime TOUT le dossier temp/ - À utiliser uniquement en cas d'urgence
   */
  forceCleanupAllTempFiles(confirmDelete = false) {
    if (!confirmDelete) {
      console.error('❌ ARRÊT DE SÉCURITÉ: Cette fonction supprime TOUT le dossier temp/');
      console.error('❌ Pour confirmer, appelez: processor.forceCleanupAllTempFiles(true)');
      return false;
    }

    console.warn('🚨 SUPPRESSION FORCÉE DE TOUT LE DOSSIER TEMP/ 🚨');
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        console.log(`🗑️  TOUT SUPPRIMÉ: ${this.tempDir}`);
        return true;
      }
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression forcée: ${error.message}`);
      return false;
    }
  }
  /**
   * Lance le traitement complet
   */
  async run() {
    console.log('🚀 FEN Processor - Multithread Ultra-Performant');
    console.log('==================================================');
    console.log(`📁 Input: ${this.inputFile}`);
    console.log(`📁 Temp: ${this.tempDir}`);
    console.log(`📂 Output: ${this.outputDir}`);
    console.log(`🔢 Chunk size: ${this.chunkSize.toLocaleString()} positions`);
    console.log(`🧵 Workers: ${this.numWorkers} cores`);
    console.log(`📦 Batch size: ${this.batchSize} games par batch`);
    console.log(`🔄 Mode reprise: ${this.resumeMode ? 'OUI (depuis _sorted)' : 'NON'}\n`);

    console.time('⏱️  Traitement complet');

    try {
      await this.countTotalGames();
      if (!this.resumeMode)
        await this.processPgnFileMultithread();
      await this.processAllChunks();
      const sortedFiles = await this.getSortedFiles();


      const mergeResult = await this.multiPhaseKWayMerge(sortedFiles, true);


      await this.sort10PlusOccByOccurrence();


      await this.generateFinalFiles();


      const finalResult = await this.calculateFinalStats();
      this.cleanupPartitionFiles();
      this.cleanupPhaseDirectories();      console.log('\n🛡️  Traitement complet réussi - nettoyage final des fichiers _sorted...');
      this.cleanupSortedFiles();


      console.log('🧵 Fermeture du pool de merge workers...');
      await this.mergeWorkerPool.shutdown();

      console.timeEnd('⏱️  Traitement complet');
      console.log('\n📊 STATISTIQUES FINALES:');
      console.log(`   🎮 Parties traitées: ${this.gamesProcessedCount.toLocaleString()}/${this.totalGames.toLocaleString()}`);
      console.log(`   📝 Positions extraites: ${this.positionsProcessed.toLocaleString()}`);
      console.log(`   🔢 Positions uniques: ${mergeResult.positionsWritten.toLocaleString()}`);
      console.log(`   🎯 Index position → games: ${this.positionIndexFile}`);
      console.log(`   🔥 Positions ≥10 occ: ${finalResult.onlyRecurrentCount.toLocaleString()} (${((finalResult.onlyRecurrentCount / mergeResult.positionsWritten) * 100).toFixed(1)}%)`);
      console.log(`   🔹 Positions 2-9 occ: ${(finalResult.withoutOneCount - finalResult.onlyRecurrentCount).toLocaleString()} (${(((finalResult.withoutOneCount - finalResult.onlyRecurrentCount) / mergeResult.positionsWritten) * 100).toFixed(1)}%)`);
      console.log(`   🔸 Positions 1 occ: ${(finalResult.allCount - finalResult.withoutOneCount).toLocaleString()} (${(((finalResult.allCount - finalResult.withoutOneCount) / mergeResult.positionsWritten) * 100).toFixed(1)}%)`);

      console.log(`\n📄 FICHIERS GÉNÉRÉS:`);
      console.log(`   📄 fens-all.tsv (${finalResult.allCount.toLocaleString()} positions)`);
      console.log(`   📄 fens-withoutone.tsv (${finalResult.withoutOneCount.toLocaleString()} positions)`);
      console.log(`   📄 fens-onlyrecurrent.tsv (${finalResult.onlyRecurrentCount.toLocaleString()} positions)`);
      console.log(`   🎯 Index: ${this.positionIndexFile}`);

      const fensAllFile = path.join(this.outputDir, 'fens-all.tsv');
      if (fs.existsSync(fensAllFile)) {
        const stats = fs.statSync(fensAllFile);
        console.log(`   💾 Taille du fichier principal: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      }

      console.log('\n✅ Traitement complet terminé avec succès !');

      return mergeResult.positionsWritten;    }
    catch (error) {
      console.error('\n❌ Erreur:', error.message);
      console.error('Stack:', error.stack);
      console.error('🛡️  SÉCURITÉ: Aucun nettoyage automatique en cas d\'erreur - vos fichiers temp/ sont préservés');
      console.error('🛡️  Utilisez check-temp-status.js pour diagnostiquer l\'état des fichiers temporaires');


      try {
        console.log('🧵 Nettoyage d\'urgence du pool de merge workers...');
        await this.mergeWorkerPool.shutdown();
      } catch (shutdownError) {
        console.error('❌ Erreur lors du shutdown des workers:', shutdownError.message);
      }

      throw error;
    }
  }

  /**
   * Trie le fichier 10plusocc par occurrence décroissante et crée fens-onlyrecurrent.tsv
   */
  async sort10PlusOccByOccurrence() {
    console.log(`\n🔄 Tri du fichier 10plusocc et création de fens-onlyrecurrent.tsv...`);
    console.time('⏱️  Tri 10plusocc');

    const partitionFile10Plus = path.join(this.tempDir, '10plusocc.tmp');
    const fensOnlyRecurrentFile = path.join(this.outputDir, 'fens-onlyrecurrent.tsv');

    if (!fs.existsSync(partitionFile10Plus)) {
      console.log('ℹ️  Aucun fichier 10plusocc à trier');

      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }
      fs.writeFileSync(fensOnlyRecurrentFile, 'fen\toccurrence\twhite\tblack\tdraw\n', { encoding: 'utf8' });
      return;
    }


    const { createInterface } = await import('readline');
    const fileStream = fs.createReadStream(partitionFile10Plus, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream });

    const lines = [];
    for await (const line of rl) {
      if (line.trim()) {
        lines.push(line);
      }
    }


    lines.sort((a, b) => {
      const occA = parseInt(a.split('\t')[1]);
      const occB = parseInt(b.split('\t')[1]);
      return occB - occA;
    });


    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(fensOnlyRecurrentFile, { encoding: 'utf8' });
    writeStream.write('fen\toccurrence\twhite\tblack\tdraw\n');

    for (const line of lines) {
      writeStream.write(line + '\n');
    }
    writeStream.end();

    await new Promise(resolve => writeStream.on('finish', resolve));

    console.timeEnd('⏱️  Tri 10plusocc');
    console.log(`✅ Fichier fens-onlyrecurrent.tsv créé avec ${lines.length} positions triées par occurrence décroissante`);
  }

  /**
   * Génère les fichiers finaux par concaténation des partitions
   */
  async generateFinalFiles() {
    console.log(`\n🔄 Génération des fichiers finaux par concaténation...`);
    console.time('⏱️  Génération fichiers finaux');

    const header = 'fen\toccurrence\twhite\tblack\tdraw\n';


    const fensAllFile = path.join(this.outputDir, 'fens-all.tsv');
    const fensWithoutOneFile = path.join(this.outputDir, 'fens-withoutone.tsv');
    const fensOnlyRecurrentFile = path.join(this.outputDir, 'fens-onlyrecurrent.tsv');

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    console.log('📄 Création de fens-withoutone.tsv...');
    const withoutOneStream = fs.createWriteStream(fensWithoutOneFile, { encoding: 'utf8' });
    withoutOneStream.write(header);


    if (fs.existsSync(fensOnlyRecurrentFile)) {
      const { createInterface } = await import('readline');
      const fileStream = fs.createReadStream(fensOnlyRecurrentFile, { encoding: 'utf8' });
      const rl = createInterface({ input: fileStream });

      let isFirstLine = true;
      for await (const line of rl) {
        if (isFirstLine) {
          isFirstLine = false;
          continue;
        }
        withoutOneStream.write(line + '\n');
      }
    }


    for (let i = 9; i >= 2; i--) {
      const partitionFile = path.join(this.tempDir, `${i}occ.tmp`);
      if (fs.existsSync(partitionFile)) {
        const readStream = fs.createReadStream(partitionFile, { encoding: 'utf8' });
        readStream.pipe(withoutOneStream, { end: false });
        await new Promise(resolve => readStream.on('end', resolve));
      }
    }
    withoutOneStream.end();
    await new Promise(resolve => withoutOneStream.on('finish', resolve));


    console.log('📄 Création de fens-all.tsv...');
    const allStream = fs.createWriteStream(fensAllFile, { encoding: 'utf8' });
    allStream.write(header);
    if (fs.existsSync(fensWithoutOneFile)) {
      const { createInterface } = await import('readline');
      const fileStream = fs.createReadStream(fensWithoutOneFile, { encoding: 'utf8' });
      const rl = createInterface({ input: fileStream });

      let isFirstLine = true;
      for await (const line of rl) {
        if (isFirstLine) {
          isFirstLine = false;
          continue;
        }
        allStream.write(line + '\n');
      }
    }


    const file1Occ = path.join(this.tempDir, '1occ.tmp');
    if (fs.existsSync(file1Occ)) {
      const readStream1Occ = fs.createReadStream(file1Occ, { encoding: 'utf8' });
      readStream1Occ.pipe(allStream, { end: false });
      await new Promise(resolve => readStream1Occ.on('end', resolve));
    }
    allStream.end();
    await new Promise(resolve => allStream.on('finish', resolve));

    console.timeEnd('⏱️  Génération fichiers finaux');
    console.log('✅ Fichiers finaux générés par concaténation');
  }

  /**
   * Nettoie les fichiers de partition temporaires
   */
  cleanupPartitionFiles() {
    console.log('🧹 Nettoyage des fichiers de partition...');

    try {

      for (let i = 1; i <= 9; i++) {
        const partitionFile = path.join(this.tempDir, `${i}occ.tmp`);
        if (fs.existsSync(partitionFile)) {
          fs.unlinkSync(partitionFile);
        }
      }

      const file10Plus = path.join(this.tempDir, '10plusocc.tmp');
      if (fs.existsSync(file10Plus)) {
        fs.unlinkSync(file10Plus);
      }

      console.log('✅ Fichiers de partition nettoyés');
    } catch (error) {
      console.warn(`⚠️  Erreur lors du nettoyage des partitions: ${error.message}`);
    }
  }

  /**
   * Nettoie les dossiers de phases intermédiaires
   */
  cleanupPhaseDirectories() {
    console.log('🧹 Nettoyage des dossiers de phases...');

    try {
      let phaseNumber = 1;
      let phaseDir = path.join(this.tempDir, `phase${phaseNumber}`);

      while (fs.existsSync(phaseDir)) {
        fs.rmSync(phaseDir, { recursive: true, force: true });
        phaseNumber++;
        phaseDir = path.join(this.tempDir, `phase${phaseNumber}`);
      }

      console.log('✅ Dossiers de phases nettoyés');
    } catch (error) {
      console.warn(`⚠️  Erreur lors du nettoyage des phases: ${error.message}`);
    }
  }

  cleanupSortedFiles() {
    console.log('🧹 Nettoyage des fichiers _sorted...');

    try {
      const sortedFiles = fs.readdirSync(this.tempDir)
        .filter(file => file.includes('_sorted.tmp'))
        .map(file => path.join(this.tempDir, file));

      if (sortedFiles.length === 0) {
        console.log('   ℹ️  Aucun fichier _sorted trouvé à nettoyer');
        return;
      }

      for (const file of sortedFiles) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }

      console.log(`✅ ${sortedFiles.length} fichiers _sorted nettoyés`);
    } catch (error) {
      console.warn(`⚠️  Erreur lors du nettoyage des fichiers _sorted: ${error.message}`);
    }
  }

  /**
    * Récupère les fichiers _sorted
   */
  async getSortedFiles() {
    console.log('\n🔄 REPRISE DU TRAITEMENT DEPUIS LES FICHIERS _SORTED');

    if (!fs.existsSync(this.tempDir)) {
      throw new Error(`Dossier temporaire non trouvé: ${this.tempDir}`);
    }

    const sortedFiles = fs.readdirSync(this.tempDir)
      .filter(file => file.includes('_sorted.tmp'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/chunk_(\d+)_sorted\.tmp/)?.[1] || 0);
        const numB = parseInt(b.match(/chunk_(\d+)_sorted\.tmp/)?.[1] || 0);
        return numA - numB;
      })
      .map(file => path.join(this.tempDir, file));

    if (sortedFiles.length === 0) {
      throw new Error(`Aucun fichier _sorted trouvé dans ${this.tempDir}. Veuillez d'abord exécuter le tri complet.`);
    }

    console.log(`📂 ${sortedFiles.length} fichiers _sorted trouvés pour reprise`);

    return sortedFiles;
  }
}

process.on('uncaughtException', (error) => {
  console.error('\n💥 CRASH UNCAUGHT EXCEPTION:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 CRASH UNHANDLED REJECTION:', reason);
  console.error('Stack:', reason?.stack || 'No stack trace');
  process.exit(1);
});


const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  const inputFileName = config.withOnlineGame ? config.finalPGNFileName : config.officialPGNFileName;
  const outputFileName = inputFileName.replace('.pgn', '-pgi.tsv');

  console.log(`
♟️  Extracteur de positions FEN
==============================

Usage: node fen.js [fichier.pgn] [options]

Arguments:
  fichier.pgn    Fichier PGN source (optionnel)
                 Par défaut: ${inputFileName}

Options:
  --help, -h     Affiche cette aide
  --resume       Mode reprise (reprend où ça s'est arrêté)

Description:
  Extrait toutes les positions FEN depuis un fichier PGN et les organise
  en chunks triés pour un accès rapide.

Configuration actuelle:
  • Mode: ${config.withOnlineGame ? 'COMPLET (avec sources en ligne)' : 'HORS-LIGNE (TWIC + PGN Mentor)'}
  • Fichier source: ${inputFileName}
  • Index généré: ${outputFileName}

Fichiers générés:
  • temp/chunk_*.tmp        (chunks temporaires)
  • temp/chunk_*_sorted.tmp (chunks triés)
  • output/${outputFileName}  (index FEN → Game ID)

Performance:
  • Workers: ${os.cpus().length} (tous les cœurs CPU)
  • Chunk size: 3M positions max
  • Streaming: RAM constante même sur gros fichiers
`);
  process.exit(0);
}


let customInputFile = null;
if (args.length > 0 && !args[0].startsWith('--')) {
  customInputFile = path.resolve(args[0]);

  if (!fs.existsSync(customInputFile)) {
    console.error(`❌ Erreur: Fichier non trouvé: ${customInputFile}`);
    process.exit(1);
  }

  if (!customInputFile.endsWith('.pgn')) {
    console.error(`❌ Erreur: Le fichier doit avoir l'extension .pgn`);
    process.exit(1);
  }
}


const processor = new FenProcessor();


if (customInputFile) {
  processor.inputFile = customInputFile;


  const baseFileName = path.basename(customInputFile, '.pgn');
  processor.positionIndexFile = path.join(processor.outputDir, `${baseFileName}-pgi.tsv`);

  console.log(`📁 Fichier personnalisé: ${customInputFile}`);
  console.log(`🎯 Index personnalisé: ${processor.positionIndexFile}`);
}

processor.run().catch((error) => {
  console.error('\n💥 CRASH PRINCIPAL:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

#!/usr/bin/env node

import { parentPort } from 'worker_threads';
import fs from 'fs';
import path from 'path';

/**
 * Worker dédié pour exécuter un merge K-way dans un thread séparé
 * Reçoit une liste de fichiers à merger et produit un fichier de sortie
 */

class MergeWorker {
  constructor() {
    this.workerId = Math.random().toString(36).substr(2, 9);
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
   * Lit plusieurs lignes d'un coup pour optimiser les performances I/O
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
   * K-way merge vers un seul fichier agrégé (pour phases intermédiaires)
   */
  async kWayMergeToSingleFile(inputFiles, outputFile, isFirstPhase) {
    let positionsWritten = 0;
    const startTime = Date.now();

    try {
      const outputStream = fs.createWriteStream(outputFile, {
        encoding: 'utf8',
        highWaterMark: 8 * 1024 * 1024
      });

      const readers = inputFiles.map((file, index) => {
        const readStream = fs.createReadStream(file, {
          encoding: 'utf8',
          highWaterMark: 8 * 1024 * 1024
        });
        return {
          file,
          index,
          readStream,
          buffer: '',
          currentLine: null,
          finished: false,
          streamEnded: false,
          lineQueue: []
        };
      });

      // Initialiser la lecture de tous les readers
      await Promise.all(readers.map(reader => this.readNextLineBatch(reader, 100)));

      let currentFen = null;
      let currentStats = { occurrence: 0, white: 0, black: 0, draw: 0 };

      let writeBuffer = '';
      const writeBufferLimit = 1024 * 1024;

      while (readers.some(r => !r.finished)) {
        // Recharger les readers qui ont besoin de plus de données
        const readersToReload = readers.filter(r => !r.finished && r.lineQueue.length < 10);
        if (readersToReload.length > 0) {
          await Promise.all(readersToReload.map(r => this.readNextLineBatch(r, 50)));
        }

        // Trouver la position FEN minimale parmi tous les readers
        const currentPositions = [];
        for (const reader of readers) {
          if (!reader.finished && reader.lineQueue.length > 0) {
            const line = reader.lineQueue[0];
            if (isFirstPhase) {
              const firstPipe = line.indexOf('|');
              if (firstPipe !== -1) {
                const hash = line.substring(0, firstPipe);
                const secondPipe = line.indexOf('|', firstPipe + 1);
                const fen = line.substring(firstPipe + 1, secondPipe !== -1 ? secondPipe : line.length);
                currentPositions.push({ hash, fen, reader, line, firstPipe, secondPipe });
              }
            } else {
              const separatorIndex = line.indexOf('\t');
              if (separatorIndex !== -1) {
                const hash = line.substring(0, separatorIndex);
                currentPositions.push({ hash, reader, line, separatorIndex });
              }
            }
          }
        }

        if (currentPositions.length === 0) break;

        currentPositions.sort((a, b) => a.hash.localeCompare(b.hash));
        const minHash = currentPositions[0].hash;
        const minFen = currentPositions[0].fen;

        // Si on change de hash, écrire la position actuelle
        if (currentFen !== null && currentFen.hash !== minHash) {
          const line = `${currentFen.hash}\t${currentFen.fen}\t${currentStats.occurrence}\t${currentStats.white}\t${currentStats.black}\t${currentStats.draw}\n`;
          writeBuffer += line;

          if (writeBuffer.length >= writeBufferLimit) {
            outputStream.write(writeBuffer);
            writeBuffer = '';
          }

          positionsWritten++;
          currentStats = { occurrence: 0, white: 0, black: 0, draw: 0 };
        }

        currentFen = { hash: minHash, fen: minFen };

        // Traiter tous les readers qui ont la position minimale
        for (const pos of currentPositions) {
          if (pos.hash !== minHash) break;

          const reader = pos.reader;
          const line = reader.lineQueue.shift();

          if (isFirstPhase) {
            const result = line.substring(pos.secondPipe + 1);
            currentStats.occurrence += 1;
            switch (result) {
              case '1-0': currentStats.white += 1; break;
              case '0-1': currentStats.black += 1; break;
              case '1/2-1/2': currentStats.draw += 1; break;
            }
          } else {
            const dataStr = line.substring(pos.separatorIndex + 1);
            const tabs = [pos.separatorIndex];
            for (let i = pos.separatorIndex + 1; i < line.length; i++) {
              if (line[i] === '\t') tabs.push(i);
              if (tabs.length === 5) break;
            }

            currentStats.occurrence += parseInt(line.substring(tabs[1] + 1, tabs[2])) || 0;
            currentStats.white += parseInt(line.substring(tabs[2] + 1, tabs[3])) || 0;
            currentStats.black += parseInt(line.substring(tabs[3] + 1, tabs[4])) || 0;
            currentStats.draw += parseInt(line.substring(tabs[4] + 1)) || 0;
          }

          if (reader.lineQueue.length === 0 && reader.streamEnded) {
            reader.finished = true;
          }
        }
      }

      // Écrire la dernière position
      if (currentFen !== null) {
        const line = `${currentFen.hash}\t${currentFen.fen}\t${currentStats.occurrence}\t${currentStats.white}\t${currentStats.black}\t${currentStats.draw}\n`;
        writeBuffer += line;
        positionsWritten++;
      }

      if (writeBuffer.length > 0) {
        outputStream.write(writeBuffer);
      }

      for (const reader of readers) {
        reader.readStream.destroy();
      }

      outputStream.end();
      await new Promise(resolve => outputStream.on('finish', resolve));

      const elapsed = (Date.now() - startTime) / 1000;

      return {
        success: true,
        positionsWritten,
        inputFiles: inputFiles.length,
        outputFile: path.basename(outputFile),
        elapsedTime: this.formatTime(elapsed),
        workerId: this.workerId
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        stack: error.stack,
        workerId: this.workerId
      };
    }
  }
}

// Écouter les messages du thread principal
if (parentPort) {
  const worker = new MergeWorker();

  parentPort.on('message', async (message) => {
    const { inputFiles, outputFile, isFirstPhase, batchId } = message;

    try {
      const result = await worker.kWayMergeToSingleFile(inputFiles, outputFile, isFirstPhase);

      parentPort.postMessage({
        ...result,
        batchId
      });
    } catch (error) {
      parentPort.postMessage({
        success: false,
        error: error.message,
        stack: error.stack,
        batchId,
        workerId: worker.workerId
      });
    }
  });
  parentPort.on('error', (error) => {
    console.error('Worker error:', error);
  });
}

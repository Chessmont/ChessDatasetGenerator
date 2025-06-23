#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import { createReadStream, createWriteStream } from 'fs';
import pkg from 'simple-zstd';
const { ZSTDDecompress } = pkg;
import { fileURLToPath } from 'url';
import WorkerPool from './worker-pool.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerScript = path.join(__dirname, 'filter-worker.js');

class LichessProcessor {  constructor() {
    this.baseUrl = 'https://database.lichess.org/standard/';
    this.outputDir = './scripts/output';
    this.outputFileAll = path.join(this.outputDir, 'lichess-all.pgn');
    this.outputFileLimited = path.join(this.outputDir, 'lichess-limited.pgn');
    this.outputFileEval = path.join(this.outputDir, 'lichess-eval.pgn');
    this.tempDir = './scripts/temp';
    this.ensureDirectories();
  }  ensureDirectories() {
    [this.outputDir, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Créer les fichiers de sortie vides dès le démarrage
    this.initializeOutputFiles();
  }

  /**
   * Initialise les fichiers de sortie vides
   */
  initializeOutputFiles() {
    try {
      if (!fs.existsSync(this.outputFileAll)) {
        fs.writeFileSync(this.outputFileAll, '', 'utf8');
        console.log(`📁 Fichier créé: ${this.outputFileAll}`);
      }
      if (!fs.existsSync(this.outputFileLimited)) {
        fs.writeFileSync(this.outputFileLimited, '', 'utf8');
        console.log(`📁 Fichier créé: ${this.outputFileLimited}`);
      }
      if (!fs.existsSync(this.outputFileEval)) {
        fs.writeFileSync(this.outputFileEval, '', 'utf8');
        console.log(`📁 Fichier créé: ${this.outputFileEval}`);
      }
    } catch (error) {
      console.error(`Erreur initialisation fichiers: ${error.message}`);
    }
  }

  createUrlFromDate(dateString) {
    const [year, month] = dateString.split('-');
    const filename = `lichess_db_standard_rated_${dateString}.pgn.zst`;

    return {
      url: this.baseUrl + filename,
      filename,
      year: parseInt(year),
      month
    };
  }

  generateUrls(startYear = 2013, startMonth = 1) {
    const urls = [];
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    for (let year = startYear; year <= currentYear; year++) {
      const startM = year === startYear ? startMonth : 1;
      const endM = year === currentYear ? currentMonth - 1 : 12;

      for (let month = startM; month <= endM; month++) {
        const monthStr = month.toString().padStart(2, '0');
        const dateString = `${year}-${monthStr}`;
        urls.push(this.createUrlFromDate(dateString));
      }
    }

    return urls;
  }

  /**
   * Télécharge un fichier depuis une URL
   */
  async downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputPath);

      const request = https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Erreur HTTP: ${response.statusCode}`));
          return;
        }

        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
        });

        response.pipe(file);
      });

      file.on('finish', () => {
        file.close();
        resolve();
      });

      request.on('error', (err) => {
        fs.unlink(outputPath, () => { }); // Supprimer le fichier partiel
        reject(err);
      });

      file.on('error', (err) => {
        fs.unlink(outputPath, () => { }); // Supprimer le fichier partiel
        reject(err);
      });
    });
  }  /**
   * Décompresse un fichier .zst en streaming natif - AUCUNE limite de taille
   * Utilise simple-zstd pour un vrai streaming sans charger en mémoire
   */
  async decompressZst(inputPath, outputPath) {
    try {
      // Vérifier la taille du fichier d'entrée
      const stats = await fs.promises.stat(inputPath);
      const fileSizeGB = (stats.size / 1024 / 1024 / 1024).toFixed(2);
      console.log(`📦 Décompression streaming natif: ${fileSizeGB} GB`);

      return new Promise((resolve, reject) => {
        const inputStream = createReadStream(inputPath);
        const decompressStream = ZSTDDecompress();
        const outputStream = createWriteStream(outputPath);

        // Pipeline de streaming : input -> decompress -> output
        inputStream
          .pipe(decompressStream)
          .pipe(outputStream);

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
            const outputStats = await fs.promises.stat(outputPath);
            const outputSizeGB = (outputStats.size / 1024 / 1024 / 1024).toFixed(2);
            console.log(`✅ Décompression streaming réussie: ${outputSizeGB} GB`);
            resolve();
          } catch (error) {
            reject(new Error(`Erreur vérification fichier: ${error.message}`));
          }
        });
      });

    } catch (error) {
      throw new Error(`Erreur lors de la décompression streaming: ${error.message}`);
    }
  }

  /**
   * Filtre les parties PGN avec streaming multithread - optimisé pour les gros fichiers
   * Ne charge jamais tout le fichier en mémoire, découpe et traite à la volée
   */  async filterGames(inputPath, year, month) {
    console.log(`Filtrage streaming multithread: ${year}-${month}`);

    const workerPool = new WorkerPool(workerScript);

    try {
      console.time('⏱️  Streaming Processing');
      const stats = await this.streamingFilterGames(inputPath, workerPool);
      console.timeEnd('⏱️  Streaming Processing');

      console.log(`Filtrage terminé: ${stats.filteredAll} all, ${stats.filteredLimited} limited sur ${stats.total}`);
      return stats;

    } finally {
      // Toujours fermer le pool de workers
      await workerPool.shutdown();
    }
  }

  /**
   * Télécharge et décompresse un mois (étape 1 du pipeline)
   */
  async downloadAndDecompress(urlData) {
    const { url, filename, year, month } = urlData;
    const zstPath = path.join(this.tempDir, filename);
    const pgnPath = path.join(this.tempDir, filename.replace('.zst', ''));


    try {
      console.time(`⏱️  Download+Decompress ${year}-${month}`);
      // 1. Télécharger
      await this.downloadFile(url, zstPath);

      // 2. Décompresser
      await this.decompressZst(zstPath, pgnPath);

      // 3. Supprimer le .zst pour économiser l'espace
      await this.deleteFile(zstPath);

      console.timeEnd(`⏱️  Download+Decompress ${year}-${month}`);
      return { pgnPath, year, month };
    } catch (error) {
      // Nettoyer en cas d'erreur
      await this.deleteFile(zstPath);
      await this.deleteFile(pgnPath);
      throw error;
    }
  }

  /**
   * Télécharge seulement un fichier (sans décompression)
   */
  async downloadOnly(urlData) {
    const { url, filename, year, month } = urlData;
    const zstPath = path.join(this.tempDir, filename);


    try {
      await this.downloadFile(url, zstPath);

      return { zstPath, filename, year, month };
    } catch (error) {
      await this.deleteFile(zstPath);
      throw error;
    }
  }

  /**
   * Décompresse seulement un fichier déjà téléchargé
   */
  async decompressOnly(downloadData) {
    const { zstPath, filename, year, month } = downloadData;
    const pgnPath = path.join(this.tempDir, filename.replace('.zst', ''));

    try {
      await this.decompressZst(zstPath, pgnPath);

      await this.deleteFile(zstPath);

      return { pgnPath, year, month };
    } catch (error) {
      await this.deleteFile(zstPath);
      await this.deleteFile(pgnPath);
      throw error;
    }
  }  /**
   * Traite un fichier PGN déjà téléchargé (étape 2 du pipeline)
   */
  async processDownloadedFile(downloadedData) {
    const { pgnPath, year, month } = downloadedData;

    console.time(`⏱️  Total Processing ${year}-${month}`);

    try {      // Filtrer et écrire directement dans les fichiers finaux
      const stats = await this.filterGames(pgnPath, year, month);

      // Nettoyer le fichier temporaire
      await this.deleteFile(pgnPath);

      console.timeEnd(`⏱️  Total Processing ${year}-${month}`);
      return stats;
    } catch (error) {
      // Nettoyer en cas d'erreur
      await this.deleteFile(pgnPath);
      throw error;
    }
  }

  /**
   * Supprime un fichier
   */
  async deleteFile(filePath) {
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Impossible de supprimer ${filePath}: ${err.message}`);
      }
    }
  }

  /**
   * Consolide tous les fichiers d'un dossier en un seul fichier
   * Ne traite que les fichiers qui existent et contiennent des parties
   */
  async consolidateFiles(sourceDir, outputFile, label) {
    console.log(`Consolidation ${label}...`); try {
      // Vérifier que le dossier source existe
      if (!fs.existsSync(sourceDir)) {
        console.log(`Dossier ${sourceDir} n'existe pas`);
        return;
      }

      const files = await fs.promises.readdir(sourceDir);
      const pgnFiles = files.filter(file => file.endsWith('.pgn')).sort();

      if (pgnFiles.length === 0) {
        console.log(`Aucun fichier .pgn trouvé dans ${sourceDir}`);
        return;
      }

      // Créer le fichier de sortie seulement s'il y a des parties à consolider
      let writeStream = null;
      let totalGames = 0;

      for (const file of pgnFiles) {
        const filePath = path.join(sourceDir, file);        // Vérifier que le fichier existe et n'est pas vide
        try {
          const stats = await fs.promises.stat(filePath);
          if (stats.size === 0) {
            continue;
          }
        } catch (err) {
          continue;
        }

        const content = await fs.promises.readFile(filePath, 'utf8');

        // Compter les parties (approximatif)
        const gameMatches = content.match(/\[Event /g);
        const gameCount = gameMatches ? gameMatches.length : 0;

        if (gameCount === 0) {
          continue;
        }

        // Créer le flux d'écriture à la première partie valide
        if (!writeStream) {
          writeStream = createWriteStream(outputFile);
        }

        writeStream.write(content);
        totalGames += gameCount;
      } if (writeStream) {
        writeStream.end();
        console.log(`${label} consolidé: ${totalGames} parties`);
      } else {
        console.log(`Aucune partie trouvée pour ${label}`);
      }

    } catch (error) {
      console.error(`Erreur consolidation ${label}: ${error.message}`);
    }
  }

  /**
   * Traitement streaming des parties PGN - découpe et traite à la volée sans charger tout en mémoire
   */  async streamingFilterGames(inputPath, workerPool) {
    return new Promise((resolve, reject) => {
      const readStream = createReadStream(inputPath, { encoding: 'utf8', highWaterMark: 64 * 1024 });

      // État du parsing
      let buffer = '';
      let currentChunk = '';
      let currentChunkGameCount = 0;
      let chunkId = 0;
      const maxGamesPerChunk = 2000;

      // Statistiques globales
      let totalGames = 0;
      let totalFilteredAll = 0;
      let totalFilteredLimited = 0;
      let totalFilteredEval = 0;

      // Gestion des chunks en cours de traitement
      const processingPromises = [];

      // Flux d'écriture (créés à la demande)
      let writeStreamAll = null;
      let writeStreamLimited = null;
      let writeStreamEval = null;

      // Fonction pour traiter un chunk complet
      const processChunk = async (chunkText, id) => {
        try {
          const result = await workerPool.execute({
            chunkText: chunkText,
            chunkId: id
          });
          totalGames += result.totalGames;
          totalFilteredAll += result.filteredAll;
          totalFilteredLimited += result.filteredLimited;
          totalFilteredEval += result.filteredEval;          // Écrire les parties ALL
          if (result.gamesAll.length > 0) {
            if (!writeStreamAll) {
              writeStreamAll = createWriteStream(this.outputFileAll, { flags: 'a' });
            }
            for (const game of result.gamesAll) {
              writeStreamAll.write(game + '\n\n');
            }
          }

          // Écrire les parties LIMITED
          if (result.gamesLimited.length > 0) {
            if (!writeStreamLimited) {
              writeStreamLimited = createWriteStream(this.outputFileLimited, { flags: 'a' });
            }
            for (const game of result.gamesLimited) {
              writeStreamLimited.write(game + '\n\n');
            }
          }

          // Écrire les parties EVAL
          if (result.gamesEval.length > 0) {
            if (!writeStreamEval) {
              writeStreamEval = createWriteStream(this.outputFileEval, { flags: 'a' });
            }
            for (const game of result.gamesEval) {
              writeStreamEval.write(game + '\n\n');
            }
          }

        } catch (error) {
          console.error(`Erreur chunk ${id}: ${error.message}`);
        }
      };

      // Fonction pour finaliser un chunk et l'envoyer au traitement
      const finalizeChunk = () => {
        if (currentChunk.trim() && currentChunkGameCount > 0) {
          const promise = processChunk(currentChunk, chunkId++);
          processingPromises.push(promise);

          currentChunk = '';
          currentChunkGameCount = 0;
        }
      };

      // Parsing ligne par ligne
      let currentGame = '';
      let inGame = false;

      readStream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('[Event ')) {
            // Nouvelle partie détectée
            if (inGame && currentGame) {
              // Finaliser la partie précédente
              currentChunk += currentGame + '\n\n';
              currentChunkGameCount++;

              // Vérifier si on doit créer un nouveau chunk
              if (currentChunkGameCount >= maxGamesPerChunk) {
                finalizeChunk();
              }
            }
            currentGame = line + '\n';
            inGame = true;
          } else if (inGame) {
            currentGame += line + '\n';
          }
        }
      });

      readStream.on('end', async () => {
        try {
          // Traiter la dernière partie et le dernier chunk
          if (inGame && currentGame) {
            currentChunk += currentGame + '\n\n';
            currentChunkGameCount++;
          }

          if (currentChunk.trim()) {
            finalizeChunk();
          }

          // Attendre que tous les chunks soient traités
          console.log(`Attente du traitement de ${processingPromises.length} chunks...`);
          await Promise.all(processingPromises);

          // Fermer les flux d'écriture
          if (writeStreamAll) {
            writeStreamAll.end();
          } if (writeStreamLimited) {
            writeStreamLimited.end();
          }
          if (writeStreamEval) {
            writeStreamEval.end();
          }

          console.log(`Streaming terminé: ${chunkId} chunks traités`);

          resolve({
            total: totalGames,
            filteredAll: totalFilteredAll,
            filteredLimited: totalFilteredLimited,
            filteredEval: totalFilteredEval
          });

        } catch (error) {
          reject(error);
        }
      });

      readStream.on('error', reject);
    });
  }
}

export default LichessProcessor;

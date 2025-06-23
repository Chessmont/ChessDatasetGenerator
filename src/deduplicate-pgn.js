#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Script de déduplication PGN
 * Usage: node deduplicate-pgn.js <fichier.pgn>
 */

class PgnDeduplicator {
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
    this.outputFile = this.generateOutputFilename(inputFile);
    this.outputDir = path.join(__dirname, '..', 'output');


    this.CHUNK_SIZE = 5000000;
    this.hashChunks = [];
    this.currentChunk = new Set();
    this.hashChunks.push(this.currentChunk);

    this.stats = {
      totalGames: 0,
      uniqueGames: 0,
      duplicateGames: 0
    };
  }

  /**
   * Génère le nom de fichier de sortie en ajoutant "-deduplicated"
   */
  generateOutputFilename(inputFile) {
    const basename = path.basename(inputFile, '.pgn');
    return `${basename}-deduplicated.pgn`;
  }

  /**
   * Génère un hash pour une partie (optimisé pour Chess.com)
   */
  generateGameHash(pgn) {
    if (!pgn || typeof pgn !== 'string') {
      return null;
    }


    const linkMatch = pgn.match(/\[Link "https:\/\/www\.chess\.com\/game\/live\/(\d+)"\]/);
    if (linkMatch) {

      return `chesscom-${linkMatch[1]}`;
    }

    const whiteMatch = pgn.match(/\[White "([^"]+)"\]/);
    const blackMatch = pgn.match(/\[Black "([^"]+)"\]/);
    const dateMatch = pgn.match(/\[Date "([^"]+)"\]/);
    const siteMatch = pgn.match(/\[Site "([^"]+)"\]/);
    const whiteEloMatch = pgn.match(/\[WhiteElo "([^"]+)"\]/);
    const blackEloMatch = pgn.match(/\[BlackElo "([^"]+)"\]/);    if (!whiteMatch || !blackMatch || !dateMatch) {
      return `unique-${Date.now()}-${Math.random()}`;
    }



    const hashComponents = [
      siteMatch?.[1] || '',
      dateMatch[1],
      whiteMatch[1],
      blackMatch[1],
      whiteEloMatch?.[1] || '',
      blackEloMatch?.[1] || ''
    ];

    const hashString = hashComponents.join('-');
    return hashString.toLowerCase();
  }

  /**
   * Vérifie si un hash existe déjà (recherche dans tous les chunks)
   */
  hasHash(hash) {

    for (const chunk of this.hashChunks) {
      if (chunk.has(hash)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Ajoute un hash (avec gestion des chunks)
   */
  addHash(hash) {

    if (this.currentChunk.size >= this.CHUNK_SIZE) {
      console.log(`\n💾 Chunk ${this.hashChunks.length} plein (${this.currentChunk.size.toLocaleString()} hashs), création d'un nouveau chunk...`);
      this.currentChunk = new Set();
      this.hashChunks.push(this.currentChunk);


      const estimatedMemoryMB = this.hashChunks.length * this.CHUNK_SIZE * 80 / 1024 / 1024;
      console.log(`📊 Chunks actifs: ${this.hashChunks.length} (~${estimatedMemoryMB.toFixed(0)} MB RAM)`);
    }

    this.currentChunk.add(hash);
  }

  /**
   * Obtient le nombre total de hashs stockés
   */
  getTotalHashCount() {
    return this.hashChunks.reduce((total, chunk) => total + chunk.size, 0);
  }

  /**
   * Obtient des statistiques mémoire détaillées
   */
  getMemoryStats() {
    const totalHashes = this.getTotalHashCount();
    const chunksCount = this.hashChunks.length;
    const estimatedMemoryMB = Math.round((totalHashes * 80) / (1024 * 1024));

    return {
      totalHashes,
      chunksCount,
      estimatedMemoryMB,      avgHashesPerChunk: chunksCount > 0 ? Math.round(totalHashes / chunksCount) : 0
    };
  }

  /**
   * Libère toute la mémoire des hashs
   */
  clearAllHashes() {
    for (const chunk of this.hashChunks) {
      chunk.clear();
    }
    this.hashChunks = [];
    this.currentChunk = new Set();
    this.hashChunks.push(this.currentChunk);
  }

  /**
   * Déduplique un fichier PGN en streaming (optimisé pour les gros fichiers)
   * Utilise la détection par [Event pour une robustesse maximale
   */
  async deduplicateFile(inputFile) {
    const fileName = path.basename(inputFile);
    console.log(`🧹 DÉBUT DÉDUPLICATION STREAMING: ${fileName}`);
    console.log('===============================================');

    if (!fs.existsSync(inputFile)) {
      console.log(`❌ Fichier introuvable: ${inputFile}`);
      return;
    }


    const fileStats = await fs.promises.stat(inputFile);    const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 Taille du fichier: ${fileSizeMB} MB`);


    this.stats = {
      totalGames: 0,
      uniqueGames: 0,
      duplicateGames: 0,
      processedBytes: 0,
      totalBytes: fileStats.size
    };


    const tempFile = inputFile + '.temp';
    const writeStream = createWriteStream(tempFile, { encoding: 'utf8' });


    const readStream = createReadStream(inputFile, { encoding: 'utf8' });
    const rl = createInterface({
      input: readStream,
      crlfDelay: Infinity
    });

    console.log('🔄 Traitement en streaming (détection par [Event)...');

    let currentGame = '';
    let lineCount = 0;
    let lastProgressUpdate = Date.now();

    for await (const line of rl) {
      lineCount++;
      this.stats.processedBytes += Buffer.byteLength(line + '\n', 'utf8');


      const now = Date.now();
      if (now - lastProgressUpdate > 2000) {
        const progress = ((this.stats.processedBytes / this.stats.totalBytes) * 100).toFixed(1);
        const processedMB = (this.stats.processedBytes / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r🔄 Progression: ${progress}% (${processedMB}/${fileSizeMB} MB) | Parties: ${this.stats.totalGames} | Uniques: ${this.stats.uniqueGames} | Doublons: ${this.stats.duplicateGames}`);
        lastProgressUpdate = now;
      }


      if (line.startsWith('[Event ')) {

        if (currentGame.trim() !== '') {
          this.stats.totalGames++;

          const gameHash = this.generateGameHash(currentGame);

          if (gameHash) {
            if (this.hasHash(gameHash)) {

              this.stats.duplicateGames++;
            } else {

              this.addHash(gameHash);
              this.stats.uniqueGames++;


              writeStream.write(currentGame + '\n\n');
            }
          }
        }


        currentGame = line + '\n';
      } else {

        currentGame += line + '\n';
      }
    }


    if (currentGame.trim() !== '') {
      this.stats.totalGames++;      const gameHash = this.generateGameHash(currentGame);

      if (gameHash) {
        if (this.hasHash(gameHash)) {
          this.stats.duplicateGames++;
        } else {
          this.addHash(gameHash);
          this.stats.uniqueGames++;
          writeStream.write(currentGame + '\n\n');
        }
      }
    }


    writeStream.end();


    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log('\n💾 Sauvegarde du fichier dédupliqué...');


    const backupFile = inputFile + '.backup';
    await fs.promises.rename(inputFile, backupFile);
    await fs.promises.rename(tempFile, inputFile);

    console.log('\n✅ DÉDUPLICATION TERMINÉE !');
    console.log('===========================');
    console.log(`📊 Parties originales: ${this.stats.totalGames.toLocaleString()}`);
    console.log(`📊 Parties uniques: ${this.stats.uniqueGames.toLocaleString()}`);
    console.log(`📊 Doublons supprimés: ${this.stats.duplicateGames.toLocaleString()}`);

    if (this.stats.totalGames > 0) {
      console.log(`📊 Taux de doublons: ${((this.stats.duplicateGames / this.stats.totalGames) * 100).toFixed(2)}%`);
    }


    const memoryStats = this.getMemoryStats();
    console.log(`📊 Chunks mémoire utilisés: ${memoryStats.chunksCount}`);
    console.log(`📊 Hashs stockés: ${memoryStats.totalHashes.toLocaleString()}`);
    console.log(`📊 Mémoire estimée: ${memoryStats.estimatedMemoryMB} MB`);


    try {
      const originalStats = await fs.promises.stat(backupFile);
      const newStats = await fs.promises.stat(inputFile);
      const originalSizeMB = (originalStats.size / 1024 / 1024).toFixed(1);
      const newSizeMB = (newStats.size / 1024 / 1024).toFixed(1);
      const savedMB = (originalSizeMB - newSizeMB).toFixed(1);
      const savedPercent = ((savedMB / originalSizeMB) * 100).toFixed(1);

      console.log(`📊 Taille originale: ${originalSizeMB} MB`);
      console.log(`📊 Nouvelle taille: ${newSizeMB} MB`);
      console.log(`📊 Espace économisé: ${savedMB} MB (${savedPercent}%)`);
    } catch (error) {
      console.warn('⚠️  Impossible de calculer les tailles de fichiers');
    }

    console.log(`📁 Fichier nettoyé: ${inputFile}`);
    console.log(`📁 Backup sauvé: ${backupFile}`);
    console.log('💡 Tu peux supprimer le backup si tout est OK');


    this.clearAllHashes();
  }
}

function showHelp() {
  console.log(`
🧹 Script de Déduplication PGN
╭─────────────────────────────────────────────────────────────╮
│ Supprime les parties en double d'un fichier PGN            │
╰─────────────────────────────────────────────────────────────╯

Usage:
  node deduplicate-pgn.js <fichier.pgn>

Arguments:
  fichier.pgn     Le fichier PGN à déduplicquer

Exemples:
  node deduplicate-pgn.js output/twic.pgn
  node deduplicate-pgn.js final-dataset.pgn

Le fichier de sortie sera créé avec le suffixe "-deduplicated".
Exemple: "twic.pgn" → "twic-deduplicated.pgn"
`);
}


async function main() {
  try {
    const args = process.argv.slice(2);


    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      showHelp();
      return;
    }

    if (args.length !== 1) {
      console.error('❌ Erreur: Un seul fichier PGN doit être spécifié');
      showHelp();
      process.exit(1);
    }

    const inputFile = args[0];

    console.log('🧹 SCRIPT DE DÉDUPLICATION PGN STREAMING');
    console.log('=========================================');
    console.log('✨ Détection robuste par [Event]');
    console.log(`🎯 Fichier d'entrée: ${inputFile}`);

    const deduplicator = new PgnDeduplicator(inputFile);


    const startTime = Date.now();
    await deduplicator.deduplicateFile(inputFile);
    const endTime = Date.now();

    const durationSeconds = ((endTime - startTime) / 1000).toFixed(1);
    console.log(`⏰ Durée totale: ${durationSeconds} secondes`);
    console.log('🏆 DÉDUPLICATION TERMINÉE AVEC SUCCÈS !');

  } catch (error) {
    console.error(`❌ Erreur: ${error.message}`);
    process.exit(1);
  }
}


process.on('uncaughtException', (error) => {
  console.error('\n❌ ERREUR FATALE:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ ERREUR:', reason);
  process.exit(1);
});


main().catch(error => {
  console.error('❌ ERREUR:', error.message);
  process.exit(1);
});

#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================================
// CONFIGURATION - MODIFIEZ ICI LE FICHIER À TRAITER
// ========================================
const TARGET_FILE = 'twic-pgnmentor.pgn'; // Fichier compilé à déduplicquer
// const TARGET_FILE = '/path/complet/vers/votre/fichier.pgn'; // Ou chemin absolu

class PgnDeduplicator {
  constructor() {
    this.outputDir = path.join(__dirname, 'output');

    // Système de chunks pour éviter la limite de taille de Set
    this.CHUNK_SIZE = 5000000; // 5M parties par chunk (~400MB RAM)
    this.hashChunks = []; // Tableau de tous les chunks
    this.currentChunk = new Set(); // Chunk actuel en cours d'écriture
    this.hashChunks.push(this.currentChunk); // Ajouter le premier chunk
      this.stats = {
      totalGames: 0,
      uniqueGames: 0,
      duplicateGames: 0
    };
  }
  /**
   * Génère un hash pour une partie (optimisé pour Chess.com)
   */
  generateGameHash(pgn) {
    if (!pgn || typeof pgn !== 'string') {
      return null;
    }

    // ✨ OPTIMISATION: Pour Chess.com, utiliser l'ID du Link qui est unique
    const linkMatch = pgn.match(/\[Link "https:\/\/www\.chess\.com\/game\/live\/(\d+)"\]/);
    if (linkMatch) {
      // Hash simple et parfait pour Chess.com
      return `chesscom-${linkMatch[1]}`;
    }    // ⚠️ FALLBACK CRITIQUE: Pour Lichess, PGN Mentor, TWIC, fichiers mixtes
    // Sans ceci, les parties non-Chess.com seraient ignorées = PERTE DE DONNÉES
    const whiteMatch = pgn.match(/\[White "([^"]+)"\]/);
    const blackMatch = pgn.match(/\[Black "([^"]+)"\]/);
    const dateMatch = pgn.match(/\[Date "([^"]+)"\]/);
    const siteMatch = pgn.match(/\[Site "([^"]+)"\]/);
    const whiteEloMatch = pgn.match(/\[WhiteElo "([^"]+)"\]/);
    const blackEloMatch = pgn.match(/\[BlackElo "([^"]+)"\]/);    if (!whiteMatch || !blackMatch || !dateMatch) {
      return `unique-${Date.now()}-${Math.random()}`;
    }

    // Hash composite pour déduplication TWIC vs PGN Mentor
    // Utilise uniquement: Site, Date, White, Black, WhiteElo, BlackElo
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
    // Vérifier tous les chunks
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
    // Si le chunk actuel est plein, créer un nouveau
    if (this.currentChunk.size >= this.CHUNK_SIZE) {
      console.log(`\n💾 Chunk ${this.hashChunks.length} plein (${this.currentChunk.size.toLocaleString()} hashs), création d'un nouveau chunk...`);
      this.currentChunk = new Set();
      this.hashChunks.push(this.currentChunk);

      // Estimation mémoire
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
    const estimatedMemoryMB = Math.round((totalHashes * 80) / (1024 * 1024)); // ~80 bytes per hash

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

    // Obtenir la taille du fichier pour le suivi de progression
    const fileStats = await fs.promises.stat(inputFile);    const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 Taille du fichier: ${fileSizeMB} MB`);

    // Réinitialiser SEULEMENT les stats pour ce fichier (GARDER les hashs !)
    this.stats = {
      totalGames: 0,
      uniqueGames: 0,
      duplicateGames: 0,
      processedBytes: 0,
      totalBytes: fileStats.size
    };

    // Créer le fichier temporaire dédupliqué
    const tempFile = inputFile + '.temp';
    const writeStream = createWriteStream(tempFile, { encoding: 'utf8' });

    // Créer le stream de lecture
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

      // Afficher progression toutes les 2 secondes
      const now = Date.now();
      if (now - lastProgressUpdate > 2000) {
        const progress = ((this.stats.processedBytes / this.stats.totalBytes) * 100).toFixed(1);
        const processedMB = (this.stats.processedBytes / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r🔄 Progression: ${progress}% (${processedMB}/${fileSizeMB} MB) | Parties: ${this.stats.totalGames} | Uniques: ${this.stats.uniqueGames} | Doublons: ${this.stats.duplicateGames}`);
        lastProgressUpdate = now;
      }

      // ✨ NOUVEAU: Détecter le début d'une nouvelle partie avec [Event
      if (line.startsWith('[Event ')) {
        // Si on a déjà une partie en cours, la traiter d'abord
        if (currentGame.trim() !== '') {
          this.stats.totalGames++;

          const gameHash = this.generateGameHash(currentGame);

          if (gameHash) {
            if (this.hasHash(gameHash)) {
              // Doublon détecté
              this.stats.duplicateGames++;
            } else {
              // Nouvelle partie unique
              this.addHash(gameHash);
              this.stats.uniqueGames++;

              // Écrire dans le fichier temporaire
              writeStream.write(currentGame + '\n\n');
            }
          }
        }

        // Commencer une nouvelle partie
        currentGame = line + '\n';
      } else {
        // Ajouter la ligne à la partie courante
        currentGame += line + '\n';
      }
    }

    // Traiter la dernière partie
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

    // Fermer le stream d'écriture
    writeStream.end();

    // Attendre que l'écriture soit terminée
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log('\n💾 Sauvegarde du fichier dédupliqué...');

    // Backup de l'ancien fichier
    const backupFile = inputFile + '.backup';
    await fs.promises.rename(inputFile, backupFile);    // Remplacer par le nouveau
    await fs.promises.rename(tempFile, inputFile);

    console.log('\n✅ DÉDUPLICATION TERMINÉE !');
    console.log('===========================');
    console.log(`📊 Parties originales: ${this.stats.totalGames.toLocaleString()}`);
    console.log(`📊 Parties uniques: ${this.stats.uniqueGames.toLocaleString()}`);
    console.log(`📊 Doublons supprimés: ${this.stats.duplicateGames.toLocaleString()}`);

    if (this.stats.totalGames > 0) {
      console.log(`📊 Taux de doublons: ${((this.stats.duplicateGames / this.stats.totalGames) * 100).toFixed(2)}%`);
    }

    // Statistiques mémoire
    const memoryStats = this.getMemoryStats();
    console.log(`📊 Chunks mémoire utilisés: ${memoryStats.chunksCount}`);
    console.log(`📊 Hashs stockés: ${memoryStats.totalHashes.toLocaleString()}`);
    console.log(`📊 Mémoire estimée: ${memoryStats.estimatedMemoryMB} MB`);

    // Taille des fichiers
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

    // Libérer la mémoire
    this.clearAllHashes();
  }
}

// Fonction principale
async function main() {
  console.log('🧹 SCRIPT DE DÉDUPLICATION PGN STREAMING');
  console.log('=========================================');
  console.log('✨ Détection robuste par [Event (comme les autres scripts)');

  const deduplicator = new PgnDeduplicator();

  // Déterminer le chemin complet du fichier depuis TARGET_FILE
  let filePath;
  if (path.isAbsolute(TARGET_FILE)) {
    filePath = TARGET_FILE;
  } else {
    // Chercher d'abord dans le dossier output
    const outputPath = path.join(deduplicator.outputDir, TARGET_FILE);
    if (fs.existsSync(outputPath)) {
      filePath = outputPath;
    } else {
      // Sinon utiliser le chemin relatif
      filePath = path.resolve(TARGET_FILE);
    }
  }

  console.log(`🎯 Fichier cible: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.log(`❌ Fichier introuvable: ${filePath}`);
    console.log('');
    console.log('💡 Modifiez la constante TARGET_FILE en haut du script');
    console.log(`💡 Actuellement: TARGET_FILE = '${TARGET_FILE}'`);
    process.exit(1);
  }

  // Démarrer la déduplication
  const startTime = Date.now();
  await deduplicator.deduplicateFile(filePath);
  const endTime = Date.now();

  const durationSeconds = ((endTime - startTime) / 1000).toFixed(1);
  console.log(`⏰ Durée totale: ${durationSeconds} secondes`);
  console.log('🏆 DÉDUPLICATION TERMINÉE AVEC SUCCÈS !');
}

// Gestion des erreurs
process.on('uncaughtException', (error) => {
  console.error('\n❌ ERREUR FATALE:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ ERREUR:', reason);
  process.exit(1);
});

// Lancer le script
main().catch(error => {
  console.error('❌ ERREUR:', error.message);
  process.exit(1);
});

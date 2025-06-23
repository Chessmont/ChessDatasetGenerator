#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ChesscomDownloader {
  constructor() {
    this.archiveUrlsFile = path.join(__dirname, '..', 'chesscom-archive-urls.pv');
    this.processedUrlsFile = path.join(__dirname, '..', 'chesscom-processed-urls.pv');
    this.errorUrlsFile = path.join(__dirname, '..', 'chesscom-error-urls.pv');
    this.outputDir = path.join(__dirname, '..', 'output');
    this.outputFileAll = path.join(this.outputDir, 'chesscom-all.pgn');
    this.outputFileLimited = path.join(this.outputDir, 'chesscom-limited.pgn');

    // 🚀 SYSTÈME DE CHUNKS pour éviter la limite de Set sur 200Go de données
    this.CHUNK_SIZE = 5000000; // 5M parties par chunk (~400MB RAM)
    this.hashChunks = []; // Tableau de tous les chunks
    this.currentChunk = new Set(); // Chunk actuel en cours d'écriture
    this.hashChunks.push(this.currentChunk); // Ajouter le premier chunk

    this.maxConcurrent = 3; // Nombre max de requêtes en parallèle
    this.stats = {
      totalArchives: 0,
      processedArchives: 0,
      totalGames: 0,
      allGames: 0,
      limitedGames: 0,
      duplicateGames: 0,
      errors: 0
    };
    this.ensureDirectories();
  }
  ensureDirectories() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

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
    } catch (error) {
      console.error(`Erreur initialisation fichiers: ${error.message}`);
    }
  }

  /**
   * Charge la liste des URLs d'archives
   */
  async loadArchiveUrls() {
    try {
      if (!fs.existsSync(this.archiveUrlsFile)) {
        throw new Error(`Fichier ${this.archiveUrlsFile} introuvable`);
      }

      const content = await fs.promises.readFile(this.archiveUrlsFile, 'utf8');
      const urls = content.trim().split('\n').filter(u => u.length > 0);

      console.log(`📂 Chargé: ${urls.length} URLs d'archives`);
      return urls;
    } catch (error) {
      throw new Error(`Erreur lecture URLs: ${error.message}`);
    }
  }

  /**
   * Charge la liste des URLs déjà traitées
   */
  async loadProcessedUrls() {
    try {
      if (!fs.existsSync(this.processedUrlsFile)) {
        return new Set();
      }

      const content = await fs.promises.readFile(this.processedUrlsFile, 'utf8');
      const urls = content.trim().split('\n').filter(u => u.length > 0);

      console.log(`📂 URLs déjà traitées: ${urls.length}`);
      return new Set(urls);
    } catch (error) {
      console.warn(`Erreur lecture URLs traitées: ${error.message}`);
      return new Set();
    }
  }

  /**
   * Marque une URL comme traitée
   */
  async markUrlProcessed(url) {
    try {
      await fs.promises.appendFile(this.processedUrlsFile, url + '\n', 'utf8');
    } catch (error) {
      console.error(`Erreur sauvegarde URL traitée: ${error.message}`);
    }
  }  /**
   * Marque une URL comme ayant une erreur
   */
  async markUrlError(url) {
    try {
      await fs.promises.appendFile(this.errorUrlsFile, url + '\n', 'utf8');
    } catch (error) {
      console.error(`Erreur sauvegarde URL erreur: ${error.message}`);
    }
  }
  /**
   * Traite une archive avec gestion des erreurs
   */
  async processArchiveSafe(url) {
    try {
      const result = await this.processArchive(url);
      await this.markUrlProcessed(url);
      return result;
    } catch (error) {
      await this.markUrlError(url);
      this.stats.errors++;
      return { all: 0, limited: 0 };
    }
  }

  /**
   * Traite les archives avec contrôle de concurrence
   */
  async processArchivesConcurrent(urls) {
    const results = [];
    const inProgress = new Set();
    let urlIndex = 0;

    while (urlIndex < urls.length || inProgress.size > 0) {
      // Lancer nouvelles requêtes jusqu'à maxConcurrent
      while (inProgress.size < this.maxConcurrent && urlIndex < urls.length) {
        const url = urls[urlIndex++];
        const promise = this.processArchiveSafe(url);
        inProgress.add(promise);

        promise.finally(() => {
          inProgress.delete(promise);
          this.stats.processedArchives++;
          this.showProgress();
        });
      }

      // Attendre qu'au moins une requête se termine
      if (inProgress.size > 0) {
        await Promise.race(inProgress);
      }
    }

    return results;  }
  /**
   * Génère un hash simple pour détecter les doublons (optimisé pour Chess.com)
   */
  generateGameHash(pgn) {
    // Vérifier que pgn est une string valide
    if (!pgn || typeof pgn !== 'string') {
      return null;
    }

    // ✨ OPTIMISATION: Pour Chess.com, utiliser l'ID du Link qui est unique
    const linkMatch = pgn.match(/\[Link "https:\/\/www\.chess\.com\/game\/live\/(\d+)"\]/);
    if (linkMatch) {
      // Hash simple et parfait pour Chess.com
      return `chesscom-${linkMatch[1]}`;
    }

    // Fallback pour autres sources - hash composite
    const whiteMatch = pgn.match(/\[White "([^"]+)"\]/);
    const blackMatch = pgn.match(/\[Black "([^"]+)"\]/);
    const dateMatch = pgn.match(/\[Date "([^"]+)"\]/);
    const utcTimeMatch = pgn.match(/\[UTCTime "([^"]+)"\]/);
    const siteMatch = pgn.match(/\[Site "([^"]+)"\]/);

    if (!whiteMatch || !blackMatch || !dateMatch || !utcTimeMatch) {
      return null; // PGN invalide - manque White, Black, Date ou UTCTime
    }

    // Hash basé sur les joueurs, date, heure UTC et site
    const hashString = `${whiteMatch[1]}-${blackMatch[1]}-${dateMatch[1]}-${utcTimeMatch[1]}-${siteMatch?.[1] || ''}`;
    return hashString.toLowerCase();
  }/**
   * Vérifie si une partie respecte les critères de filtrage (ALL)
   */
  meetsFilterCriteriaAll(game) {
    try {
      // Vérifier que game et game.pgn existent
      if (!game || !game.pgn || typeof game.pgn !== 'string') {
        return false;
      }

      const { pgn } = game;

      // 1. Extraire les ELO des joueurs
      const whiteElo = this.extractElo(pgn, 'WhiteElo');
      const blackElo = this.extractElo(pgn, 'BlackElo');

      // 2. Vérifier ELO ≥2400 pour les deux joueurs
      if (!whiteElo || !blackElo || whiteElo < 2400 || blackElo < 2400) {
        return false;
      }      // 3. Vérifier profondeur ≥10 ply (compter les coups)
      const moveCount = this.countMoves(pgn);
      if (moveCount < 10) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn(`Erreur filtrage partie ALL: ${error.message}`);
      return false;
    }
  }

  /**
   * Vérifie si une partie respecte les critères de filtrage (LIMITED - sans bullet)
   */
  meetsFilterCriteriaLimited(game) {
    try {
      // D'abord vérifier les critères ALL
      if (!this.meetsFilterCriteriaAll(game)) {
        return false;
      }

      const { time_control } = game;

      // Vérifier la cadence (≥180s pour limited)
      if (!this.isValidTimeControl(time_control)) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Vérifie si le time_control est valide (≥180s)
   */
  isValidTimeControl(timeControl) {
    if (!timeControl) return false;

    // Format: "180" ou "180+2" ou "1/86400" (daily)
    if (timeControl.includes('/')) {
      return false; // Exclure les parties daily
    }

    const seconds = parseInt(timeControl.split('+')[0]);
    return seconds >= 180;
  }

  /**
   * Extrait l'ELO d'un joueur depuis le PGN
   */
  extractElo(pgn, eloTag) {
    const match = pgn.match(new RegExp(`\\[${eloTag} "(\\d+)"\\]`));
    return match ? parseInt(match[1]) : null;
  }

  /**
   * Compte le nombre de coups dans une partie
   */
  countMoves(pgn) {
    // Extraire la section des coups (après les métadonnées)
    const lines = pgn.split('\n');
    const moveLines = lines.filter(line =>
      !line.startsWith('[') &&
      !line.startsWith('{') &&
      line.trim().length > 0
    );

    const movesText = moveLines.join(' ');
    // Compter les numéros de coups (1. 2. 3. etc.)
    const moveNumbers = movesText.match(/\d+\./g);
    return moveNumbers ? moveNumbers.length * 2 : 0; // *2 car chaque numéro = 2 ply
  }

  /**
   * Télécharge et traite une archive
   */
  async processArchive(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'chessmont-dataset/1.0 (contact: dataset@chessmont.com)'
        }
      });      if (!response.ok) {
        if (response.status === 404) {
          await this.markUrlError(url);
          this.stats.errors++;
          return { all: 0, limited: 0 };
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
        if (!data.games || data.games.length === 0) {
        return { all: 0, limited: 0 };
      }

      let filteredCountAll = 0;
      let filteredCountLimited = 0;
        // Traiter chaque partie de l'archive
      for (const game of data.games) {
        this.stats.totalGames++;

        // Vérifier que la partie a un PGN valide
        if (!game || !game.pgn || typeof game.pgn !== 'string') {
          continue; // Ignorer les parties sans PGN valide
        }

        // Vérifier les doublons d'abord
        const gameHash = this.generateGameHash(game.pgn);
        if (!gameHash) {
          continue; // PGN invalide
        }        if (this.hasHash(gameHash)) {
          this.stats.duplicateGames++;
          continue; // Doublon détecté
        }

        // Vérifier filtres ALL (ELO + profondeur)
        const passesAll = this.meetsFilterCriteriaAll(game);
        if (passesAll) {
          this.addHash(gameHash);
          await this.saveGameAll(game.pgn);
          filteredCountAll++;
          this.stats.allGames++;

          // Vérifier aussi LIMITED (+ cadence)
          const passesLimited = this.meetsFilterCriteriaLimited(game);
          if (passesLimited) {
            await this.saveGameLimited(game.pgn);
            filteredCountLimited++;            this.stats.limitedGames++;
          }
        }
      }return { all: filteredCountAll, limited: filteredCountLimited };
    } catch (error) {
      await this.markUrlError(url);
      this.stats.errors++;
      return { all: 0, limited: 0 };
    }
  }

  /**
   * Sauvegarde une partie dans le fichier ALL
   */
  async saveGameAll(pgn) {
    try {
      await fs.promises.appendFile(this.outputFileAll, pgn + '\n\n', 'utf8');
    } catch (error) {
      console.error(`Erreur sauvegarde partie ALL: ${error.message}`);
    }  }

  /**
   * Sauvegarde une partie dans le fichier LIMITED
   */
  async saveGameLimited(pgn) {
    try {
      await fs.promises.appendFile(this.outputFileLimited, pgn + '\n\n', 'utf8');
    } catch (error) {
      console.error(`Erreur sauvegarde partie LIMITED: ${error.message}`);
    }  }
    /**
   * Affiche les statistiques de progression
   */
  showProgress() {
    const progress = ((this.stats.processedArchives / this.stats.totalArchives) * 100).toFixed(1);
    const eta = this.calculateETA();
    const elapsed = this.getElapsedTime();
    process.stdout.write(`\r📊 [${progress}%] ${this.stats.processedArchives}/${this.stats.totalArchives} archives | 🎯 ${this.stats.allGames} parties (${this.stats.limitedGames} limited) | 🔄 ${this.stats.duplicateGames} doublons | ❌ ${this.stats.errors} erreurs | ⏱️  ${elapsed}${eta ? ` / ETA ${eta}` : ''}`);
  }

  /**
   * Calcule le temps écoulé depuis le début
   */
  getElapsedTime() {
    if (!this.startTime) return '0s';

    const elapsed = Date.now() - this.startTime;

    if (elapsed < 60000) return `${Math.round(elapsed/1000)}s`;
    if (elapsed < 3600000) return `${Math.round(elapsed/60000)}min`;
    return `${Math.round(elapsed/3600000)}h${Math.round((elapsed % 3600000)/60000)}min`;
  }

  /**
   * Calcule l'ETA basé sur la vitesse actuelle
   */
  calculateETA() {
    if (!this.startTime || this.stats.processedArchives === 0) return null;

    const elapsed = Date.now() - this.startTime;
    const avgTimePerArchive = elapsed / this.stats.processedArchives;
    const remaining = this.stats.totalArchives - this.stats.processedArchives;
    const etaMs = remaining * avgTimePerArchive;

    if (etaMs < 60000) return `${Math.round(etaMs/1000)}s`;
    if (etaMs < 3600000) return `${Math.round(etaMs/60000)}min`;
    return `${Math.round(etaMs/3600000)}h`;
  }
  /**
   * Traite toutes les archives
   */
  async processAllArchives() {
    console.log('🚀 Début du téléchargement et filtrage des archives Chess.com...');

    const allUrls = await this.loadArchiveUrls();
    const processedUrls = await this.loadProcessedUrls();

    const remainingUrls = allUrls.filter(url => !processedUrls.has(url));

    if (remainingUrls.length === 0) {
      console.log('✅ Toutes les archives ont déjà été traitées !');
      return;
    }    this.stats.totalArchives = remainingUrls.length;
    console.log(`🎯 ${remainingUrls.length} archives à traiter`);

    // Créer les fichiers de sortie vides si besoin
    if (!fs.existsSync(this.outputFileAll)) {
      await fs.promises.writeFile(this.outputFileAll, '', 'utf8');
      console.log(`📁 Fichier créé: ${this.outputFileAll}`);
    }    if (!fs.existsSync(this.outputFileLimited)) {
      await fs.promises.writeFile(this.outputFileLimited, '', 'utf8');
      console.log(`📁 Fichier créé: ${this.outputFileLimited}`);
    }

    // ✨ NOUVEAU: Préchargement des hashs existants pour éviter les doublons
    await this.preloadExistingHashes();

    this.startTime = Date.now();

    // Traitement parallèle des archives
    await this.processArchivesConcurrent(remainingUrls);

    // Affichage final de progression
    this.showProgress();

    const duration = ((Date.now() - this.startTime) / 1000 / 60).toFixed(1);

    console.log('\n\n🏆 TRAITEMENT TERMINÉ !');
    console.log('======================');
    console.log(`⏱️  Durée: ${duration} minutes`);
    console.log(`📊 Archives traitées: ${this.stats.processedArchives}`);
    console.log(`📊 Parties totales: ${this.stats.totalGames}`);
    console.log(`📊 Parties ALL (ELO≥2400): ${this.stats.allGames}`);
    console.log(`📊 Parties LIMITED (ELO≥2400 + cadence≥180s): ${this.stats.limitedGames}`);
    console.log(`📊 Doublons évités: ${this.stats.duplicateGames}`);
    console.log(`📊 Erreurs: ${this.stats.errors}`);
    console.log(`📁 Fichier ALL: ${this.outputFileAll}`);
    console.log(`📁 Fichier LIMITED: ${this.outputFileLimited}`);

    // Taille des fichiers finaux
    try {
      const statsAll = await fs.promises.stat(this.outputFileAll);
      const sizeMBAll = (statsAll.size / 1024 / 1024).toFixed(1);
      console.log(`📊 Taille ALL: ${sizeMBAll} MB`);

      const statsLimited = await fs.promises.stat(this.outputFileLimited);
      const sizeMBLimited = (statsLimited.size / 1024 / 1024).toFixed(1);
      console.log(`📊 Taille LIMITED: ${sizeMBLimited} MB`);
    } catch (error) {
      console.warn('Impossible de récupérer la taille des fichiers');
    }
  }
  /**
   * Précharge les hashs des parties déjà présentes dans le fichier ALL
   * pour éviter les doublons lors d'une reprise de téléchargement
   */
  async preloadExistingHashes() {
    console.log('🔄 Préchargement des hashs existants...');

    // ✅ Analyser SEULEMENT le fichier ALL (qui contient toutes les parties)
    // LIMITED est un sous-ensemble de ALL, donc pas besoin de l'analyser
    const filePath = this.outputFileAll;
    let totalPreloadedGames = 0;

    if (!fs.existsSync(filePath)) {
      console.log('ℹ️  Aucun fichier existant à précharger');
      return;
    }

    const fileName = path.basename(filePath);
    console.log(`📂 Analyse de ${fileName}...`);

    try {
      const fileStats = await fs.promises.stat(filePath);
      const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
      console.log(`   Taille: ${fileSizeMB} MB`);

      // Si le fichier est vide, on passe
      if (fileStats.size === 0) {
        console.log(`   ⚠️  Fichier vide, ignoré`);
        return;
      }

      // Streaming pour lire le fichier ligne par ligne
      const readStream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({
        input: readStream,
        crlfDelay: Infinity
      });

      let currentGame = '';
      let gameCount = 0;
      let lastUpdate = Date.now();

      for await (const line of rl) {
        // Détecter le début d'une nouvelle partie avec [Event
        if (line.startsWith('[Event ')) {
          // Si on a déjà une partie en cours, la traiter d'abord
          if (currentGame.trim() !== '') {
            const gameHash = this.generateGameHash(currentGame);

            if (gameHash && !this.hasHash(gameHash)) {
              this.addHash(gameHash);
              gameCount++;
              totalPreloadedGames++;

              // Afficher progression toutes les 3 secondes
              const now = Date.now();
              if (now - lastUpdate > 3000) {
                process.stdout.write(`\r   📊 Parties préchargées: ${gameCount.toLocaleString()}`);
                lastUpdate = now;
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

      // Traiter la dernière partie si nécessaire
      if (currentGame.trim() !== '') {
        const gameHash = this.generateGameHash(currentGame);
        if (gameHash && !this.hasHash(gameHash)) {
          this.addHash(gameHash);
          gameCount++;
          totalPreloadedGames++;
        }
      }

      console.log(`\r   ✅ ${gameCount.toLocaleString()} hashs préchargés depuis ${fileName}`);

    } catch (error) {
      console.log(`   ❌ Erreur lors de la lecture de ${fileName}: ${error.message}`);
    }

    if (totalPreloadedGames > 0) {
      const memoryStats = this.getMemoryStats();
      console.log(`🎯 Total: ${totalPreloadedGames.toLocaleString()} hashs préchargés`);
      console.log(`💾 Chunks utilisés: ${memoryStats.chunksCount}`);
      console.log(`💾 Mémoire utilisée: ~${memoryStats.estimatedMemoryMB} MB`);
    } else {
      console.log('ℹ️  Aucun hash préchargé (fichier vide ou inexistant)');
    }
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
      estimatedMemoryMB,
      avgHashesPerChunk: chunksCount > 0 ? Math.round(totalHashes / chunksCount) : 0
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
}

export default ChesscomDownloader;

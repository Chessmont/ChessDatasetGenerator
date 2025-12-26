#!/usr/bin/env node

import fs from 'fs';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { createWriteStream, createReadStream } from 'fs';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Extract } from 'unzipper';
import { createInterface } from 'readline';
import { nanoid } from 'nanoid';

class PGNMentorProcessor {
  constructor() {
    this.baseUrl = 'https://www.pgnmentor.com';
    this.outputFile = './src/output/pgnmentor.pgn';
    this.tempDir = './src/temp';

    // Déduplication - Set en mémoire des hash des parties
    this.gameHashes = new Set();

    // Configuration retry
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 secondes

    this.ensureDirectories();
  }
  ensureDirectories() {
    const outputDir = './src/output';
    [outputDir, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Charge tous les hash existants depuis le fichier de sortie
   */
  async loadExistingHashes() {
    if (!fs.existsSync(this.outputFile)) {
      console.log('🔄 Aucun fichier existant, démarrage à zéro');
      return;
    }

    console.log('🔄 Chargement des hash existants...');
    console.time('Chargement hash');

    let gameCount = 0;
    let currentGame = '';

    const fileStream = createReadStream(this.outputFile, { encoding: 'utf8' });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      const trimmed = line.trim();

      if (trimmed.startsWith('[Event ')) {
        // Début d'une nouvelle partie
        if (currentGame) {
          // Traiter la partie précédente
          const hash = this.hashGame(currentGame);
          this.gameHashes.add(hash);
          gameCount++;

          if (gameCount % 10000 === 0) {
            process.stdout.write(`\r🔄 ${gameCount} parties chargées...`);
          }
        }
        currentGame = trimmed + '\n';
      } else if (currentGame) {
        currentGame += trimmed + '\n';
      }
    }

    // Traiter la dernière partie
    if (currentGame) {
      const hash = this.hashGame(currentGame);
      this.gameHashes.add(hash);
      gameCount++;
    }

    console.timeEnd('Chargement hash');
    console.log(`\n✅ ${gameCount} parties existantes chargées (${this.gameHashes.size} hash uniques)`);
  }
  /**
   * Supprime un dossier/fichier de manière robuste (Windows)
   */
  async cleanupPath(path, isDirectory = false) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (fs.existsSync(path)) {
          if (isDirectory) {
            // Forcer les permissions avant suppression
            this.forceUnlockDirectory(path);
            fs.rmSync(path, { recursive: true, force: true, maxRetries: 3 });
          } else {
            fs.rmSync(path, { force: true, maxRetries: 3 });
          }
        }
        return; // Succès
      } catch (error) {
        if (attempt === 3) {
          console.warn(`⚠️  Impossible de supprimer ${path}: ${error.message}`);
          return; // Abandon après 3 tentatives
        }

        console.warn(`⚠️  Tentative ${attempt}/3 de suppression de ${path} échouée, retry...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * Force le déverrouillage d'un dossier (Windows)
   */
  forceUnlockDirectory(dirPath) {
    try {
      if (fs.existsSync(dirPath)) {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const item of items) {
          const fullPath = `${dirPath}/${item.name}`;
          try {
            if (item.isDirectory()) {
              this.forceUnlockDirectory(fullPath);
            }
            fs.chmodSync(fullPath, 0o777); // Permissions complètes
          } catch (error) {
            // Ignorer les erreurs de permissions individuelles
          }
        }
        fs.chmodSync(dirPath, 0o777);
      }
    } catch (error) {
      // Ignorer les erreurs de chmod
    }
  }/**
   * Récupère tous les liens PGN depuis la page principale
   */
  async getAllPgnLinks() {
    console.log('🔍 Scraping de la page PGN Mentor...');

    const html = await this.downloadContent('https://www.pgnmentor.com/files.html');
    console.log(`📄 HTML téléchargé: ${html.length} caractères`);

    // Debug: afficher quelques exemples de liens
    const allLinks = html.match(/<a[^>]+href="[^"]*\.(pgn|zip)"[^>]*>/gi);
    if (allLinks && allLinks.length > 0) {
      console.log(`🔍 Exemples de liens trouvés:`);
      allLinks.slice(0, 3).forEach(link => console.log(`  ${link}`));
    } else {
      console.log(`❌ Aucun lien .pgn ou .zip trouvé dans le HTML`);
      // Afficher un extrait du HTML pour debug
      const sample = html.slice(0, 500);
      console.log(`📄 Extrait HTML:\n${sample}`);
    }

    const links = [];
    const seenNames = new Set();

    // Regex pour trouver tous les liens .pgn
    const pgnRegex = /<a[^>]+href="([^"]+\.pgn)"[^>]*>/gi;
    let match;

    while ((match = pgnRegex.exec(html)) !== null) {
      const url = match[1].startsWith('http') ? match[1] : this.baseUrl + '/' + match[1];
      // Extraire le nom du fichier depuis l'URL
      const name = url.split('/').pop();

      // Filtrer les noms valides et éviter les doublons
      if (name && name.endsWith('.pgn') && name.length > 4 && !seenNames.has(name)) {
        seenNames.add(name);
        links.push({ url, name });
      }
    }

    console.log(`📋 ${links.length} liens PGN trouvés`);
    return links;
  }

  /**
   * Récupère tous les liens ZIP depuis la page principale
   */
  async getAllZipLinks() {
    console.log('🔍 Scraping des fichiers ZIP...');

    const html = await this.downloadContent('https://www.pgnmentor.com/files.html');
    console.log(`📄 HTML téléchargé: ${html.length} caractères`);

    const links = [];
    const seenNames = new Set();

    // Regex pour trouver tous les liens .zip
    const zipRegex = /<a[^>]+href="([^"]+\.zip)"[^>]*>/gi;
    let match;

    while ((match = zipRegex.exec(html)) !== null) {
      const url = match[1].startsWith('http') ? match[1] : this.baseUrl + '/' + match[1];
      // Extraire le nom du fichier depuis l'URL
      const name = url.split('/').pop();

      // Filtrer les noms valides et éviter les doublons
      if (name && name.endsWith('.zip') && name.length > 4 && !seenNames.has(name)) {
        seenNames.add(name);
        links.push({ url, name });
      }
    }

    console.log(`📦 ${links.length} liens ZIP trouvés`);
    return links;
  }  /**
   * Télécharge le contenu depuis une URL avec retry
   */
  async downloadContent(url) {
    return this.withRetry(async () => {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;

        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          }
        };

        const request = client.get(options, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode} pour ${url}`));
            return;
          }

          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => resolve(data));
        });

        request.on('error', reject);
        request.setTimeout(30000, () => {
          request.destroy();
          reject(new Error('Timeout'));
        });
      });
    }, `Téléchargement ${url}`);
  }
  /**
   * Génère un hash unique pour une partie PGN - version améliorée
   */
  hashGame(gameContent) {
    // Extraire les headers essentiels et TOUS les coups
    const headers = {};
    const lines = gameContent.split('\n');
    let moves = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const match = trimmed.match(/\[(\w+)\s+"([^"]+)"\]/);
        if (match) {
          const [, key, value] = match;
          // Headers critiques pour identifier une partie unique
          if (['White', 'Black', 'Date', 'Event', 'Site'].includes(key)) {
            headers[key] = value;
          }
        }
      } else if (trimmed && !trimmed.startsWith('[')) {
        // Nettoyer et normaliser les coups
        moves += trimmed.replace(/\s+/g, ' ').replace(/\{[^}]*\}/g, '').trim();
      }
    }

    // Créer une signature unique avec TOUS les coups pour éviter les faux doublons
    const signature = JSON.stringify(headers) + '|' + moves;
    return crypto.createHash('md5').update(signature).digest('hex');
  }
  /**
   * Télécharge un fichier et le sauvegarde avec retry
   */
  async downloadFile(url, filePath) {
    return this.withRetry(async () => {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;

        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive'
          }
        };

        const request = client.get(options, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode} pour ${url}`));
            return;
          }

          const writeStream = createWriteStream(filePath);
          response.pipe(writeStream);

          writeStream.on('finish', () => resolve());
          writeStream.on('error', reject);
        });

        request.on('error', reject);
        request.setTimeout(60000, () => {
          request.destroy();
          reject(new Error('Timeout'));
        });
      });
    }, `Téléchargement fichier ${url}`);
  }

  /**
   * Extrait un fichier ZIP dans un dossier avec retry
   */
  async extractZip(zipPath, extractDir) {
    return this.withRetry(async () => {
      await pipeline(
        createReadStream(zipPath),
        Extract({ path: extractDir })
      );
    }, `Extraction ${zipPath}`);
  }
  /**
   * Traite un fichier ZIP avec déduplication
   */
  async processZipFile(zipLink) {
    const zipPath = `${this.tempDir}/${zipLink.name}`;
    const extractDir = `${this.tempDir}/${zipLink.name.replace('.zip', '')}`;

    try {
      // Télécharger le ZIP avec retry
      await this.downloadFile(zipLink.url, zipPath);

      // Créer le dossier d'extraction
      if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true });
      }

      // Extraire le ZIP avec retry
      await this.extractZip(zipPath, extractDir);

      // Traiter tous les fichiers PGN extraits
      let totalGames = 0;
      let uniqueGames = 0;
      let duplicatesFound = 0;

      const stats = await this.withRetry(async () => {
        const files = fs.readdirSync(extractDir, { recursive: true });
        const pgnFiles = files.filter(f => f.toString().endsWith('.pgn'));

        const writeStream = createWriteStream(this.outputFile, { flags: 'a' });

        for (const pgnFile of pgnFiles) {
          const pgnPath = `${extractDir}/${pgnFile}`;
          if (fs.existsSync(pgnPath) && fs.statSync(pgnPath).isFile()) {
            try {
              const content = fs.readFileSync(pgnPath, 'utf8');
              const games = this.parsePGN(content);

              for (const game of games) {
                const hash = this.hashGame(game);

                if (!this.gameHashes.has(hash)) {
                  this.gameHashes.add(hash);
                  const gameWithSource = this.addSourceTag(game);
                  writeStream.write(gameWithSource + '\n\n');
                  uniqueGames++;
                } else {
                  duplicatesFound++;
                }
              }

              totalGames += games.length;
            } catch (error) {
              console.warn(`⚠️  Erreur lecture ${pgnPath}: ${error.message}`);
            }
          }
        }

        writeStream.end();

        return { totalGames, uniqueGames, duplicatesFound };
      }, `Traitement contenu ZIP ${zipLink.name}`);

      return stats;

    } catch (error) {
      throw new Error(`Erreur traitement ${zipLink.name}: ${error.message}`);
    } finally {
      // Nettoyer les fichiers temporaires de manière robuste
      console.log(`🧹 Nettoyage des fichiers temporaires...`);

      await this.cleanupPath(zipPath, false);
      await this.cleanupPath(extractDir, true);
    }
  }

  /**
   * Parse un contenu PGN et extrait les parties
   */
  parsePGN(content) {
    const games = [];
    const gameRegex = /(\[Event[^]*?(?=\[Event|$))/g;
    let match;

    while ((match = gameRegex.exec(content)) !== null) {
      const gameContent = match[1].trim();
      if (gameContent && gameContent.includes('[White ') && gameContent.includes('[Black ')) {
        games.push(gameContent);
      }
    }

    return games;
  }

  /**
   * Traite un fichier PGN avec déduplication
   */
  async processPgnFile(pgnLink) {
    try {
      const content = await this.downloadContent(pgnLink.url);
      const games = this.parsePGN(content);

      let uniqueGames = 0;
      let duplicatesFound = 0;

      // Ouvrir le fichier en mode append
      const writeStream = createWriteStream(this.outputFile, { flags: 'a' });

      for (const game of games) {
        const hash = this.hashGame(game);

        if (!this.gameHashes.has(hash)) {
          // Partie unique
          this.gameHashes.add(hash);
          const gameWithSource = this.addSourceTag(game);
          writeStream.write(gameWithSource + '\n\n');
          uniqueGames++;
        } else {
          duplicatesFound++;
        }
      }

      writeStream.end();

      return {
        totalGames: games.length,
        uniqueGames,
        duplicatesFound
      };

    } catch (error) {
      throw new Error(`Erreur traitement ${pgnLink.name}: ${error.message}`);
    }
  }

  /**
   * Extrait MaxElo d'une partie PGN
   */
  extractMaxElo(gameText) {
    const whiteEloMatch = gameText.match(/\[WhiteElo "(\d+)"\]/);
    const blackEloMatch = gameText.match(/\[BlackElo "(\d+)"\]/);
    const whiteElo = whiteEloMatch ? parseInt(whiteEloMatch[1]) : 0;
    const blackElo = blackEloMatch ? parseInt(blackEloMatch[1]) : 0;
    return Math.max(whiteElo, blackElo);
  }

  /**
   * Ajoute les tags [ID], [Source "Official"], [MaxElo] avant [Event]
   */
  addSourceTag(game) {
    const maxElo = this.extractMaxElo(game);
    const id = nanoid();

    return game.replace(
      /\[Event ([^\]]+)\]/,
      `[ID "${id}"]\n[Source "Official"]\n[MaxElo "${maxElo}"]\n[Event $1]`
    );
  }

  /**
   * Fonction retry générique
   */
  async withRetry(operation, operationName, maxRetries = this.maxRetries) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        // Retry spécial pour les erreurs de permissions Windows
        const isPermissionError = error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOTEMPTY';

        if (attempt === maxRetries) {
          throw new Error(`${operationName} échoué après ${maxRetries} tentatives: ${error.message}`);
        }

        console.warn(`⚠️  ${operationName} tentative ${attempt}/${maxRetries} échouée: ${error.message}`);

        // Délai plus long pour les erreurs de permissions
        const delay = isPermissionError ? this.retryDelay * 2 * attempt : this.retryDelay * attempt;
        console.log(`⏳ Retry dans ${delay}ms...`);

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

export default PGNMentorProcessor;

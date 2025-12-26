#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import unzipper from 'unzipper';
import { nanoid } from 'nanoid';

class TwicProcessor {  constructor() {
    this.baseUrl = 'https://theweekinchess.com/zips/';
    this.twicPageUrl = 'https://theweekinchess.com/twic';
    this.outputFile = './src/output/twic.pgn';
    this.tempDir = './src/temp';
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
   * Récupère le dernier numéro de semaine depuis la page TWIC
   */
  async getLatestWeekNumber() {
    return new Promise((resolve, reject) => {
      const request = https.get(this.twicPageUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Erreur HTTP: ${response.statusCode}`));
          return;
        }

        let html = '';
        response.on('data', (chunk) => {
          html += chunk;
        });

        response.on('end', () => {
          try {
            // Parser le HTML pour trouver le dernier numéro
            const latestWeek = this.parseLatestWeekFromHtml(html);
            resolve(latestWeek);
          } catch (error) {
            reject(error);
          }
        });
      });

      request.on('error', reject);
    });
  }

  /**
   * Parse le HTML pour extraire le dernier numéro de semaine
   * Cherche dans .results-table le 1er td du 3ème tr
   */
  parseLatestWeekFromHtml(html) {
    try {
      // Chercher la table des résultats
      const tableMatch = html.match(/<table[^>]*class="[^"]*results-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
      if (!tableMatch) {
        throw new Error('Table results-table non trouvée');
      }

      const tableContent = tableMatch[1];

      // Extraire tous les tr
      const trMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      if (!trMatches || trMatches.length < 3) {
        throw new Error('Pas assez de lignes dans la table');
      }

      // Prendre le 2ème tr
      const thirdTr = trMatches[1];

      // Extraire le premier td
      const tdMatch = thirdTr.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      if (!tdMatch) {
        throw new Error('Premier td non trouvé dans le 3ème tr');
      }

      // Nettoyer le contenu et extraire le numéro
      const tdContent = tdMatch[1].replace(/<[^>]*>/g, '').trim();
      const weekNumber = parseInt(tdContent);

      if (isNaN(weekNumber)) {
        throw new Error(`Numéro de semaine invalide: ${tdContent}`);
      }

      return weekNumber;
    } catch (error) {
      throw new Error(`Erreur parsing HTML: ${error.message}`);
    }
  }

  /**
   * Génère l'URL de téléchargement pour une semaine donnée
   */
  createUrlFromWeek(weekNumber) {
    const filename = `twic${weekNumber}g.zip`;
    return {
      url: this.baseUrl + filename,
      filename,
      weekNumber
    };
  }

  /**
   * Télécharge un fichier ZIP depuis une URL
   */
  async downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputPath);

      const request = https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Erreur HTTP: ${response.statusCode} pour ${url}`));
          return;
        }

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
   * Extrait les fichiers PGN d'un ZIP
   */
  async extractPgnFromZip(zipPath, extractDir) {
    return new Promise((resolve, reject) => {
      const extractedFiles = [];

      // S'assurer que le dossier d'extraction existe
      if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true });
      }

      fs.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on('entry', (entry) => {
          const fileName = entry.path;
          const type = entry.type; // 'Directory' or 'File'

          if (type === 'File' && fileName.toLowerCase().endsWith('.pgn')) {
            const outputPath = path.join(extractDir, path.basename(fileName));
            extractedFiles.push(outputPath);

            // Extraire le fichier
            entry.pipe(fs.createWriteStream(outputPath));
          } else {
            entry.autodrain();
          }
        })
        .on('close', () => {
          console.log(`Fichiers PGN extraits: ${extractedFiles.length}`);
          resolve(extractedFiles);
        })
        .on('error', reject);
    });
  }
  /**
   * Traite une semaine complète: télécharge, extrait et ajoute au fichier final
   */
  async processWeek(weekNumber) {
    console.log(`Traitement semaine ${weekNumber}...`);

    const urlData = this.createUrlFromWeek(weekNumber);
    const zipPath = path.join(this.tempDir, urlData.filename);
    const extractDir = path.join(this.tempDir, `twic${weekNumber}`);

    try {
      // 1. Télécharger le ZIP
      console.log(`📥 Téléchargement ${urlData.filename}...`);
      await this.downloadFile(urlData.url, zipPath);

      // 2. Extraire les fichiers PGN
      console.log(`📦 Extraction des PGN...`);
      const pgnFiles = await this.extractPgnFromZip(zipPath, extractDir);

      if (pgnFiles.length === 0) {
        throw new Error('Aucun fichier PGN trouvé dans le ZIP');
      }

      // 3. Ajouter directement au fichier final
      console.log(`� Ajout au fichier TWIC final...`);
      const totalGames = await this.appendPgnToFinalFile(pgnFiles);

      // 4. Nettoyer les fichiers temporaires
      await this.deleteFile(zipPath);
      await this.deleteDirectory(extractDir);

      console.log(`✅ Semaine ${weekNumber} terminée: ${totalGames} parties ajoutées`);

      return { totalGames };

    } catch (error) {
      // Nettoyer en cas d'erreur
      await this.deleteFile(zipPath);
      await this.deleteDirectory(extractDir);
      throw error;
    }
  }
  /**
   * Ajoute les fichiers PGN directement au fichier final TWIC
   */
  async appendPgnToFinalFile(pgnFiles) {
    let totalGames = 0;

    // Ouvrir le fichier en mode append
    const writeStream = fs.createWriteStream(this.outputFile, { flags: 'a' });

    try {
      for (const pgnFile of pgnFiles) {
        if (fs.existsSync(pgnFile)) {
          const content = await fs.promises.readFile(pgnFile, 'utf8');

          // Compter les parties
          const gameMatches = content.match(/\[Event /g);
          const gameCount = gameMatches ? gameMatches.length : 0;

          if (gameCount > 0) {
            // S'assurer qu'il y a un saut de ligne avant
            if (totalGames > 0 || fs.existsSync(this.outputFile)) {
              writeStream.write('\n');
            }

            const contentWithSource = this.addSourceTag(content);
            writeStream.write(contentWithSource);

            // S'assurer qu'il y a un saut de ligne après
            if (!content.endsWith('\n')) {
              writeStream.write('\n');
            }

            totalGames += gameCount;
          }
        }
      }

      return new Promise((resolve, reject) => {
        writeStream.end((err) => {
          if (err) reject(err);
          else resolve(totalGames);
        });
      });

    } catch (error) {
      writeStream.destroy();
      throw error;
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
  addSourceTag(content) {
    const games = content.split(/(?=\[Event )/);
    const processedGames = games.map(game => {
      if (!game.trim() || !game.includes('[Event ')) return game;

      const maxElo = this.extractMaxElo(game);
      const id = nanoid();
      const eventMatch = game.match(/\[Event ([^\]]+)\]/);

      if (!eventMatch) return game;

      return game.replace(
        /\[Event ([^\]]+)\]/,
        `[ID "${id}"]\n[Source "Official"]\n[MaxElo "${maxElo}"]\n[Event $1]`
      );
    });

    return processedGames.join('');
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
   * Supprime un dossier et son contenu
   */
  async deleteDirectory(dirPath) {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Impossible de supprimer ${dirPath}: ${err.message}`);
      }
    }
  }
}

export default TwicProcessor;

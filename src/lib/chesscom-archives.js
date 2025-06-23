#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ChesscomArchives {
  constructor() {
    this.usernamesFile = path.join(__dirname, '..', 'chesscomusername.pv');
    this.archiveUrlsFile = path.join(__dirname, '..', 'chesscom-archive-urls.pv');
    this.processedUsersFile = path.join(__dirname, '..', 'chesscom-processed-users.pv');
  }

  /**
   * Charge la liste des usernames
   */
  async loadUsernames() {
    try {
      if (!fs.existsSync(this.usernamesFile)) {
        throw new Error(`Fichier ${this.usernamesFile} introuvable`);
      }

      const content = await fs.promises.readFile(this.usernamesFile, 'utf8');
      const usernames = content.trim().split('\n').filter(u => u.length > 0);

      console.log(`📂 Chargé: ${usernames.length} usernames`);
      return usernames;
    } catch (error) {
      throw new Error(`Erreur lecture usernames: ${error.message}`);
    }
  }

  /**
   * Charge la liste des utilisateurs déjà traités
   */
  async loadProcessedUsers() {
    try {
      if (!fs.existsSync(this.processedUsersFile)) {
        return new Set();
      }

      const content = await fs.promises.readFile(this.processedUsersFile, 'utf8');
      const users = content.trim().split('\n').filter(u => u.length > 0);

      console.log(`📂 Utilisateurs déjà traités: ${users.length}`);
      return new Set(users);
    } catch (error) {
      console.warn(`Erreur lecture utilisateurs traités: ${error.message}`);
      return new Set();
    }
  }

  /**
   * Sauvegarde un utilisateur comme traité
   */
  async saveProcessedUser(username) {
    try {
      await fs.promises.appendFile(this.processedUsersFile, username + '\n', 'utf8');
    } catch (error) {
      console.error(`Erreur sauvegarde utilisateur traité: ${error.message}`);
    }
  }

  /**
   * Récupère les archives d'un joueur
   */
  async fetchUserArchives(username) {
    try {
      const url = `https://api.chess.com/pub/player/${username}/games/archives`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'chessmont-dataset/1.0 (contact: contact@chessmont.com)'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`⚠️  Joueur ${username} introuvable (404)`);
          return [];
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.archives || [];
    } catch (error) {
      console.error(`❌ Erreur ${username}: ${error.message}`);
      return [];
    }
  }

  /**
   * Sauvegarde les URLs d'archives
   */
  async saveArchiveUrls(urls) {
    try {
      for (const url of urls) {
        await fs.promises.appendFile(this.archiveUrlsFile, url + '\n', 'utf8');
      }
    } catch (error) {
      console.error(`Erreur sauvegarde URLs: ${error.message}`);
    }
  }

  /**
   * Traite tous les joueurs pour récupérer leurs archives
   */
  async processAllUsers() {
    console.log('🔄 Récupération des URLs d\'archives pour tous les joueurs...');

    const usernames = await this.loadUsernames();
    const processedUsers = await this.loadProcessedUsers();

    const remainingUsers = usernames.filter(username => !processedUsers.has(username));

    if (remainingUsers.length === 0) {
      console.log('✅ Tous les utilisateurs ont déjà été traités !');
      return;
    }

    console.log(`🎯 ${remainingUsers.length} utilisateurs à traiter`);

    let processed = 0;
    let totalUrls = 0;

    for (const username of remainingUsers) {
      processed++;
      console.log(`👤 [${processed}/${remainingUsers.length}] ${username}`);

      const archives = await this.fetchUserArchives(username);

      if (archives.length > 0) {
        await this.saveArchiveUrls(archives);
        totalUrls += archives.length;
        console.log(`  ✅ ${archives.length} archives trouvées`);
      } else {
        console.log(`  ⚠️  Aucune archive`);
      }

      await this.saveProcessedUser(username);
    }

    console.log(`🏆 Traitement terminé !`);
    console.log(`📊 ${processed} joueurs traités`);
    console.log(`📊 ${totalUrls} URLs d'archives récupérées`);
    console.log(`📁 URLs sauvegardées dans: ${this.archiveUrlsFile}`);
  }
  /**
   * Affiche les statistiques
   */
  async showStats() {
    try {
      const usernames = await this.loadUsernames();
      const processedUsers = await this.loadProcessedUsers();

      const remainingUsers = usernames.filter(username => !processedUsers.has(username));

      let archiveUrls = 0;
      if (fs.existsSync(this.archiveUrlsFile)) {
        const content = await fs.promises.readFile(this.archiveUrlsFile, 'utf8');
        archiveUrls = content.trim().split('\n').filter(u => u.length > 0).length;
      }

      console.log('\n📊 STATISTIQUES');
      console.log('================');
      console.log(`👥 Total joueurs: ${usernames.length}`);
      console.log(`✅ Joueurs traités: ${processedUsers.size}`);
      console.log(`⏳ Restants: ${remainingUsers.length}`);
      console.log(`🔗 URLs d'archives: ${archiveUrls}`);

      // Log des joueurs manquants
      if (remainingUsers.length > 0) {
        console.log('\n🔍 JOUEURS MANQUANTS:');
        remainingUsers.forEach((username, index) => {
          console.log(`  ${index + 1}. ${username}`);
        });
      }
    } catch (error) {
      console.error(`Erreur statistiques: ${error.message}`);
    }
  }
}

export default ChesscomArchives;

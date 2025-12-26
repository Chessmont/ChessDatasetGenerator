#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Charger la configuration
const configPath = path.join(__dirname, '..', '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

class ChesscomLeaderboard {
  constructor() {
    this.baseUrl = 'https://www.chess.com/callback/leaderboard/live?gameType=live';
    this.outputFile = path.join(__dirname, '..', 'progress/chesscomusername.pv');
    this.targetCount = config.chesscom.numberOfUsersInLeaderboard;
  }

  /**
   * Récupère tous les usernames du top 10K Chess.com
   */
  async fetchAllUsernames() {
    console.log('🎯 Récupération des top 10K joueurs Chess.com...');

    const usernames = [];
    let page = 1;
    let totalFetched = 0;

    try {
      while (totalFetched < this.targetCount) {
        console.log(`📄 Page ${page} (${totalFetched}/${this.targetCount} joueurs)`);

        const url = `${this.baseUrl}&page=${page}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': config.chesscom.userAgent,
            'Referer': 'https://www.chess.com/leaderboard/live'
          }
        });

        if (!response.ok) {
          throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Si pas de joueurs ou moins de 50 = fin du leaderboard
        if (!data.leaders || data.leaders.length === 0) {
          console.log('📊 Fin du leaderboard atteinte');
          break;
        }

        // Extraire uniquement les usernames en lowercase
        const pageUsernames = data.leaders.map(leader => leader.user.username.toLowerCase());
        usernames.push(...pageUsernames);
        totalFetched += pageUsernames.length;        // Si moins de 50 joueurs = dernière page
        if (data.leaders.length < 50) {
          console.log('📊 Dernière page atteinte');
          break;
        }

        page++;
      }

      console.log(`✅ ${usernames.length} usernames récupérés`);
      return usernames;

    } catch (error) {
      throw new Error(`Erreur lors de la récupération: ${error.message}`);
    }
  }

  /**
   * Sauvegarde les usernames dans le fichier .pv
   */
  async saveUsernames(usernames) {
    try {
      const content = usernames.join('\n') + '\n';
      await fs.promises.writeFile(this.outputFile, content, 'utf8');
      console.log(`💾 ${usernames.length} usernames sauvegardés dans ${this.outputFile}`);
    } catch (error) {
      throw new Error(`Erreur sauvegarde: ${error.message}`);
    }
  }

  /**
   * Charge les usernames depuis le fichier .pv
   */
  async loadUsernames() {
    try {
      if (!fs.existsSync(this.outputFile)) {
        return [];
      }

      const content = await fs.promises.readFile(this.outputFile, 'utf8');
      return content.trim().split('\n').filter(line => line.trim().length > 0);
    } catch (error) {
      console.warn(`Erreur lecture fichier: ${error.message}`);
      return [];
    }
  }

  /**
   * Vérifie si la liste est complète
   */
  isComplete(usernames) {
    const minRequired = this.targetCount * 0.99; // Tolérance pour les comptes supprimés/privés
    return usernames.length >= minRequired;
  }

  /**
   * Point d'entrée principal : récupère ou met à jour la liste
   */
  async ensureUsernames() {
    console.log('🔍 Vérification de la liste des usernames Chess.com...');

    const existingUsernames = await this.loadUsernames();

    if (this.isComplete(existingUsernames)) {
      console.log(`✅ Liste complète: ${existingUsernames.length} usernames`);
      return existingUsernames;
    }

    console.log(`🔄 Liste incomplète (${existingUsernames.length}), récupération...`);
    const usernames = await this.fetchAllUsernames();
    await this.saveUsernames(usernames);

    return usernames;
  }
}

export default ChesscomLeaderboard;

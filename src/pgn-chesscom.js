#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ChesscomLeaderboard from './lib/chesscom-leaderboard.js';
import ChesscomArchives from './lib/chesscom-archives.js';
import ChesscomDownloader from './lib/chesscom-downloader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ChesscomMain {
  constructor() {
    this.leaderboard = new ChesscomLeaderboard();
    this.archives = new ChesscomArchives();
    this.downloader = new ChesscomDownloader();
    this.usernamesFile = path.join(__dirname, 'chesscomusername.pv');
  }

  /**
   * Point d'entrée principal
   */
  async run() {
    try {
      console.log('🚀 DÉBUT TRAITEMENT CHESS.COM DATASET');
      console.log('=====================================');


      console.log('\n📋 ÉTAPE 1: Récupération des usernames');
      const usernames = await this.leaderboard.ensureUsernames();
      console.log(`✅ Liste prête: ${usernames.length} joueurs`);


      console.log('\n� ÉTAPE 2: Récupération des URLs d\'archives');
      await this.archives.processAllUsers();
      await this.archives.showStats();
      console.log('\n🎯 ÉTAPE 3: Téléchargement et filtrage des parties');
      await this.downloader.processAllArchives();      console.log('\n🏆 PIPELINE CHESS.COM TERMINÉ !');
      console.log('================================');
      console.log('✅ Toutes les étapes ont été complétées avec succès');
      console.log('📁 Fichiers finaux disponibles dans: apps/backend/scripts/output/');
      console.log('📁 chesscom-all.pgn (toutes parties ELO≥2400)');
      console.log('📁 chesscom-limited.pgn (sans bullet, cadence≥180s)');

    } catch (error) {
      console.error(`❌ ERREUR: ${error.message}`);
      process.exit(1);
    }
  }
}


const main = new ChesscomMain();
main.run();

export default ChesscomMain;

#!/usr/bin/env node

import TwicProcessor from './lib/twic-processor.js';
import fs from 'fs';

const PROGRESS_FILE = './scripts/twic.pv';

class TwicMain {
  constructor() {
    this.processor = new TwicProcessor();
  }

  async readProgress() {
    try {
      if (fs.existsSync(PROGRESS_FILE)) {
        const content = await fs.promises.readFile(PROGRESS_FILE, 'utf8');
        const weekNum = parseInt(content.trim());
        console.log(`Reprise depuis la semaine: ${weekNum}`);
        return weekNum;
      } else {
        console.log('Première exécution');
        await this.saveProgress(920);
        return 920;
      }
    } catch (error) {
      console.warn('Erreur lecture progression, reprise depuis 920');
      return 920;
    }
  }

  async saveProgress(weekNum) {
    try {
      await fs.promises.writeFile(PROGRESS_FILE, weekNum.toString(), 'utf8');
    } catch (error) {
      console.warn(`Impossible de sauver la progression: ${error.message}`);
    }
  }

  async run() {
    console.log('Démarrage du traitement TWIC');
    console.log('Récupération de toutes les semaines depuis 920 jusqu\'à la dernière disponible\n');

    console.time('Temps total');

    try {

      const lastWeek = await this.processor.getLatestWeekNumber();
      console.log(`Dernière semaine disponible: ${lastWeek}`);      let currentWeek = await this.readProgress();
      let totalProcessed = 0;
      let totalGames = 0;
      let consecutiveErrors = 0;
      const maxRetries = 3;while (currentWeek <= lastWeek) {
        console.log(`\nTraitement de la semaine: ${currentWeek}`);

        try {
          const timerLabel = `Temps semaine ${currentWeek}`;
          console.time(timerLabel);

          const stats = await this.processor.processWeek(currentWeek);          totalProcessed += 1;
          totalGames += stats.totalGames;
          consecutiveErrors = 0;


          const nextWeek = currentWeek + 1;
          await this.saveProgress(nextWeek);

          console.timeEnd(timerLabel);
          console.log(`✅ Semaine ${currentWeek} terminée: ${stats.totalGames} parties`);
          console.log(`📊 Total: ${totalGames} parties sur ${totalProcessed} semaines`);

          currentWeek = nextWeek;        } catch (error) {
          consecutiveErrors++;
          console.error(`❌ Erreur semaine ${currentWeek} (tentative ${consecutiveErrors}/${maxRetries}): ${error.message}`);

          if (consecutiveErrors < maxRetries) {
            console.log('🔄 Nouvelle tentative dans 5 secondes...');
            await new Promise(resolve => setTimeout(resolve, 5000));

          } else {
            console.error(`💥 ÉCHEC FATAL: Impossible de traiter la semaine ${currentWeek} après ${maxRetries} tentatives.`);
            console.error('Le script s\'arrête pour éviter de perdre des données.');
            console.error('Vérifiez le problème et relancez le script.');
            process.exit(1);
          }
        }
      }console.log('\nTraitement terminé !');
      console.log(`Résumé final:`);
      console.log(`  Semaines traitées: ${totalProcessed}`);
      console.log(`  Total parties: ${totalGames}`);
      console.log(`  Fichier final: ./scripts/output/twic.pgn`);

    } catch (error) {
      console.error('Erreur fatale:', error.message);
      process.exit(1);
    }

    console.timeEnd('Temps total');
    console.log('\nTraitement terminé !');
  }
}


const main = new TwicMain();
main.run().catch(console.error);

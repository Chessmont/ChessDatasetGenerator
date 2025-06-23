#!/usr/bin/env node

import LichessProcessor from './lib/lichess-processor.js';
import fs from 'fs';

const PROGRESS_FILE = './scripts/lichess.pv';

class LichessMain {
  constructor() {
    this.processor = new LichessProcessor();
  }

  async readProgress() {
    try {
      if (fs.existsSync(PROGRESS_FILE)) {
        const content = await fs.promises.readFile(PROGRESS_FILE, 'utf8');
        const dateStr = content.trim();
        console.log(`Reprise depuis: ${dateStr}`);
        return dateStr;
      } else {
        console.log('Première exécution');
        await this.saveProgress('2013-01');
        return '2013-01';
      }
    } catch (error) {
      console.warn('Erreur lecture progression, reprise depuis 2013-01');
      return '2013-01';
    }
  }

  async saveProgress(dateStr) {
    try {
      await fs.promises.writeFile(PROGRESS_FILE, dateStr, 'utf8');
    } catch (error) {
      console.warn(`Impossible de sauver la progression: ${error.message}`);
    }
  }
  getNextMonth(dateStr) {
    const [year, month] = dateStr.split('-').map(num => parseInt(num));
    if (month === 12) {
      return `${year + 1}-01`;
    } else {
      return `${year}-${(month + 1).toString().padStart(2, '0')}`;
    }
  }

  getLastAvailableMonth(last) {
    if (last) return last;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    if (month === 0) {
      return `${year - 1}-12`;
    } else {
      return `${year}-${month.toString().padStart(2, '0')}`;
    }
  }

  isDateBefore(date1, date2) {
    const [y1, m1] = date1.split('-').map(num => parseInt(num));
    const [y2, m2] = date2.split('-').map(num => parseInt(num));

    if (y1 < y2) return true;
    if (y1 > y2) return false;
    return m1 < m2;
  }

  /**
   * Initialise les fichiers de sortie vides
   */
  async initializeOutputFiles() {
    try {
      const fs = await import('fs');
      await fs.promises.writeFile(this.processor.outputFileAll, '', 'utf8');
      await fs.promises.writeFile(this.processor.outputFileLimited, '', 'utf8');
      await fs.promises.writeFile(this.processor.outputFileEval, '', 'utf8');
      console.log('📁 Fichiers de sortie initialisés');
    } catch (error) {
      throw new Error(`Erreur initialisation fichiers: ${error.message}`);
    }
  }

  async run() {
    console.log('Démarrage du traitement Lichess avec pipeline N+4 (5 downloads simultanés)');
    console.log('Critères: ELO >= 2200, deux outputs: all + limited (>=10min)\n');

    console.time('Temps total');

    // Initialiser les fichiers de sortie vides
    await this.initializeOutputFiles();

    const lastAvailable = this.getLastAvailableMonth();
    console.log(`Traitement jusqu'à: ${lastAvailable}`);
    let currentDate = await this.readProgress();
    let totalProcessed = 0;
    let totalFilteredAll = 0;
    let totalFilteredLimited = 0;
    let totalFilteredEval = 0;

    const downloadQueue = new Map();
    let processData = null;

    const startDownloadIfNeeded = (monthString) => {
      if (!downloadQueue.has(monthString) &&
        (this.isDateBefore(monthString, lastAvailable) || monthString === lastAvailable)) {

        const urlData = this.processor.createUrlFromDate(monthString);
        const promise = this.processor.downloadOnly(urlData)
          .then(downloadData => {
            console.log(`✅ Téléchargement ${monthString} terminé`);
            return downloadData;
          });

        downloadQueue.set(monthString, promise);
        console.log(`📥 Téléchargement ${monthString} démarré en arrière-plan`);
        return true;
      }
      return false;
    };
    // Démarrer les 5 premiers téléchargements
    let preloadMonth = currentDate;
    for (let i = 0; i < 5; i++) {
      if (startDownloadIfNeeded(preloadMonth)) {
        preloadMonth = this.getNextMonth(preloadMonth);
      } else {
        break;
      }
    }

    while (this.isDateBefore(currentDate, lastAvailable) || currentDate === lastAvailable) {
      console.log(`\nTraitement: ${currentDate}`);

      try {
        const timerLabel = `Temps ${currentDate}`;
        console.time(timerLabel);

        if (!processData) {
          const downloadPromise = downloadQueue.get(currentDate);
          if (!downloadPromise) {
            throw new Error(`Téléchargement manquant pour ${currentDate}`);
          }

          const downloadData = await downloadPromise;
          console.log(`🔄 Décompression ${currentDate} en cours...`);
          processData = await this.processor.decompressOnly(downloadData);
          console.log(`✅ Décompression ${currentDate} terminée`);

          const next5Month = this.getNextMonth(this.getNextMonth(this.getNextMonth(this.getNextMonth(this.getNextMonth(currentDate)))));
          startDownloadIfNeeded(next5Month);

          downloadQueue.delete(currentDate);
        }
        const stats = await this.processor.processDownloadedFile(processData);

        totalProcessed += stats.total;
        totalFilteredAll += stats.filteredAll;
        totalFilteredLimited += stats.filteredLimited;
        totalFilteredEval += stats.filteredEval;

        const nextMonth = this.getNextMonth(currentDate);
        await this.saveProgress(nextMonth);

        console.timeEnd(timerLabel);
        console.log(`${currentDate} terminé: ${stats.filteredAll} all, ${stats.filteredLimited} limited, ${stats.filteredEval} eval`);
        console.log(`Total: ${totalFilteredAll} all, ${totalFilteredLimited} limited, ${totalFilteredEval} eval sur ${totalProcessed}`);
        console.log(`📊 Queue: ${downloadQueue.size} téléchargements en cours`);

        currentDate = nextMonth;
        processData = null;
      } catch (error) {
        console.error(`❌ ERREUR CRITIQUE ${currentDate}: ${error.message}`);
        console.error(`❌ ARRÊT DU TRAITEMENT - Corrigez le problème et relancez`);

        // Nettoyer les ressources
        if (processData) {
          try {
            await this.processor.deleteFile(processData.pgnPath);
          } catch (cleanupError) {
            console.warn(`Erreur nettoyage: ${cleanupError.message}`);
          }
        }

        // Arrêter complètement
        throw error;
      }
    }
    if (downloadQueue.size > 0) {
      console.log(`🧹 Nettoyage de ${downloadQueue.size} téléchargements en cours...`);
      try {
        await Promise.allSettled(Array.from(downloadQueue.values()));
      } catch (error) {
        console.warn('Erreur lors du nettoyage des téléchargements:', error.message);
      }
    }
    console.log('\nTraitement terminé !');
    console.log(`Résumé final:`);
    console.log(`  All: ${totalFilteredAll} parties (ELO >= 2200)`);
    console.log(`  Limited: ${totalFilteredLimited} parties (ELO >= 2200 + Temps >= 10min)`);
    console.log(`  Eval: ${totalFilteredEval} parties (ELO >= 2200 + évaluations engine)`);
    console.log(`  Total traité: ${totalProcessed} parties`);

    console.timeEnd('Temps total');
    console.log('\nTraitement terminé ! Fichiers finaux directement disponibles :');
    console.log(`📁 ALL: ${this.processor.outputFileAll}`);
    console.log(`📁 LIMITED: ${this.processor.outputFileLimited}`);
    console.log(`📁 EVAL: ${this.processor.outputFileEval}`);
  }
}

// Lancement du script
const main = new LichessMain();
main.run().catch(console.error);

#!/usr/bin/env node

import { parentPort } from 'worker_threads';

class FilterWorker {
  constructor() {
    this.eloThreshold = 2400;
    this.timeThreshold = 180;
    this.minPlyCount = 10;
  }

  /**
   * Traite un chunk de parties PGN
   */  processChunk(chunkText, chunkId) {
    const lines = chunkText.split('\n');
    let currentGame = '';
    let gameHeaders = {};
    let inGameMoves = false;
    let gamesAll = [];
    let gamesLimited = [];
    let gamesEval = [];
    let totalGames = 0;

    const processCompleteGame = () => {
      if (currentGame.trim()) {
        totalGames++;        // Filtre ALL: ELO >= 2500 + nombre de coups >= 10
        if (this.shouldKeepGameAll(gameHeaders, currentGame)) {
          gamesAll.push(currentGame);

          // Filtre LIMITED: ELO >= 2500 + Temps >= 3min + nombre de coups >= 10
          if (this.shouldKeepGameLimited(gameHeaders, currentGame)) {
            gamesLimited.push(currentGame);
          }

          // Filtre EVAL: ELO >= 2500 + nombre de coups >= 10 + contient des évaluations
          if (this.shouldKeepGameEval(currentGame)) {
            gamesEval.push(currentGame);
          }
        }
      }

      // Reset pour la prochaine partie
      currentGame = '';
      gameHeaders = {};
      inGameMoves = false;
    };

    for (const line of lines) {
      if (line.startsWith('[Event ')) {
        if (currentGame) {
          processCompleteGame();
        }
        currentGame = line + '\n';
        gameHeaders = { Event: this.extractHeaderValue(line, 'Event') };
        inGameMoves = false;
      }
      else if (line.startsWith('[') && !inGameMoves) {
        currentGame += line + '\n';

        if (line.startsWith('[WhiteElo ')) {
          gameHeaders.WhiteElo = parseInt(this.extractHeaderValue(line, 'WhiteElo')) || 0;
        } else if (line.startsWith('[BlackElo ')) {
          gameHeaders.BlackElo = parseInt(this.extractHeaderValue(line, 'BlackElo')) || 0;
        } else if (line.startsWith('[TimeControl ')) {
          gameHeaders.TimeControl = this.extractHeaderValue(line, 'TimeControl');
        }
      }
      else if (line.trim() === '' && currentGame && !inGameMoves) {
        currentGame += line + '\n';
        inGameMoves = true;
      }
      else if (inGameMoves || (!line.startsWith('[') && currentGame)) {
        currentGame += line + '\n';
        inGameMoves = true;

        if (line.match(/\s+(1-0|0-1|1\/2-1\/2|\*)\s*$/)) {
          processCompleteGame();
        }
      }
    }

    // Traiter la dernière partie si elle existe
    if (currentGame) {
      processCompleteGame();
    }    return {
      chunkId,
      totalGames,
      gamesAll,
      gamesLimited,
      gamesEval,
      filteredAll: gamesAll.length,
      filteredLimited: gamesLimited.length,
      filteredEval: gamesEval.length
    };
  }
  /**
   * Compte le nombre de coups (ply) dans une partie PGN
   */
  countPly(gameText) {
    // Extraire seulement la partie des coups (après les headers)
    const lines = gameText.split('\n');
    let movesText = '';
    let inMoves = false;

    for (const line of lines) {
      if (line.trim() === '' && !inMoves) {
        inMoves = true;
        continue;
      }
      if (inMoves) {
        movesText += line + ' ';
      }
    }

    // Compter les coups en supprimant les numéros de coups et annotations
    const cleanMoves = movesText
      .replace(/\d+\./g, '') // Supprimer les numéros de coups (1. 2. etc.)
      .replace(/\{[^}]*\}/g, '') // Supprimer les commentaires {...}
      .replace(/\([^)]*\)/g, '') // Supprimer les variantes (...)
      .trim();

    const moves = cleanMoves.split(/\s+/).filter(move =>
      move.length > 0 &&
      !move.match(/^(1-0|0-1|1\/2-1\/2|\*)$/) // Exclure les résultats
    );

    return moves.length;
  }

  /**
   * Extrait la valeur d'un header PGN
   */
  extractHeaderValue(line, headerName) {
    const match = line.match(new RegExp(`\\[${headerName}\\s+"([^"]*)"\\]`));
    return match ? match[1] : '';
  }
  /**
   * Critères de filtrage ALL: ELO >= 2500 + coups >= 10
   */
  shouldKeepGameAll(gameHeaders, gameText) {
    const whiteElo = gameHeaders.WhiteElo || 0;
    const blackElo = gameHeaders.BlackElo || 0;
    const plyCount = this.countPly(gameText);

    return whiteElo >= this.eloThreshold &&
           blackElo >= this.eloThreshold &&
           plyCount >= this.minPlyCount;
  }

  /**
   * Critères de filtrage LIMITED: ELO >= 2500 + TimeControl >= 600s + coups >= 10
   */
  shouldKeepGameLimited(gameHeaders, gameText) {
    // D'abord vérifier les critères ALL
    if (!this.shouldKeepGameAll(gameHeaders, gameText)) {
      return false;
    }

    // Puis vérifier le TimeControl >= 600 secondes (10 minutes)
    const timeControl = gameHeaders.TimeControl || '';
    const baseTime = this.extractBaseTimeFromTimeControl(timeControl);
    return baseTime >= this.timeThreshold;
  }

  /**
   * Extrait le temps de base d'un TimeControl (ex: "300+0" -> 300)
   */
  extractBaseTimeFromTimeControl(timeControl) {
    // Format: "300+0" ou "600+5" etc.
    const match = timeControl.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }
  /**
   * Critères de filtrage EVAL: basé sur ALL + contient des évaluations
   */
  shouldKeepGameEval(gameText) {
    // Vérifier si la partie contient des évaluations [%eval ...]
    return gameText.includes('[%eval ');
  }
}

// Écouter les messages du thread principal
if (parentPort) {
  const worker = new FilterWorker();

  parentPort.on('message', (message) => {
    const { chunkText, chunkId } = message;

    try {
      const result = worker.processChunk(chunkText, chunkId);
      parentPort.postMessage({ success: true, result });
    } catch (error) {
      parentPort.postMessage({
        success: false,
        error: error.message,
        chunkId
      });
    }
  });
}

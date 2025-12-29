#!/usr/bin/env node

import { parentPort } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const configPath = path.join(__dirname, '..', '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

class FilterWorker {
  constructor() {
    this.eloThreshold = config.minOnlineElo;
    this.timeThreshold = config.minGameTime;
    this.minPlyCount = config.minPlyDepth;
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
        totalGames++;
        if (this.shouldKeepGameAll(gameHeaders, currentGame)) {
          gamesAll.push(currentGame);


          if (this.shouldKeepGameLimited(gameHeaders, currentGame)) {
            gamesLimited.push(currentGame);
          }


          if (this.shouldKeepGameEval(currentGame)) {
            gamesEval.push(currentGame);
          }
        }
      }


      currentGame = '';
      gameHeaders = {};
      inGameMoves = false;
    };

    for (const line of lines) {
      if (line.startsWith('[Event ')) {
        if (currentGame) {
          processCompleteGame();
        }
        const id = nanoid();
        const eventValue = this.extractHeaderValue(line, 'Event');
        currentGame = `[ID "${id}"]\n[Source "Online"]\n[Event "${eventValue}"]\n`;
        gameHeaders = { Event: eventValue, id };
        inGameMoves = false;
      }
      else if (line.startsWith('[') && !inGameMoves) {
        if (line.startsWith('[WhiteElo ')) {
          gameHeaders.WhiteElo = parseInt(this.extractHeaderValue(line, 'WhiteElo')) || 0;
          currentGame += line + '\n';
        } else if (line.startsWith('[BlackElo ')) {
          gameHeaders.BlackElo = parseInt(this.extractHeaderValue(line, 'BlackElo')) || 0;
          currentGame += line + '\n';
        } else if (line.startsWith('[TimeControl ')) {
          gameHeaders.TimeControl = this.extractHeaderValue(line, 'TimeControl');
          currentGame += line + '\n';
        } else if (!line.startsWith('[Event ')) {
          currentGame += line + '\n';
        }
      }
      else if (line.trim() === '' && currentGame && !inGameMoves) {
        const maxElo = Math.max(gameHeaders.WhiteElo || 0, gameHeaders.BlackElo || 0);
        currentGame = currentGame.replace(/\[MaxElo "[^"]*"\]\n?/g, '');
        currentGame = currentGame.replace(
          /(\[Source "Online"\]\n)/,
          `$1[MaxElo "${maxElo}"]\n`
        );
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


    const cleanMoves = movesText
      .replace(/\d+\./g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\([^)]*\)/g, '')
      .trim();

    const moves = cleanMoves.split(/\s+/).filter(move =>
      move.length > 0 &&
      !move.match(/^(1-0|0-1|1\/2-1\/2|\*)$/)
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
   * Critères de filtrage ALL: ELO >= config.minOnlineElo + coups >= config.minPlyDepth
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
   * Critères de filtrage LIMITED: ELO >= config.minOnlineElo + TimeControl >= config.minGameTime + coups >= config.minPlyDepth
   */
  shouldKeepGameLimited(gameHeaders, gameText) {

    if (!this.shouldKeepGameAll(gameHeaders, gameText)) {
      return false;
    }


    const timeControl = gameHeaders.TimeControl || '';
    const baseTime = this.extractBaseTimeFromTimeControl(timeControl);
    return baseTime >= this.timeThreshold;
  }

  /**
   * Extrait le temps de base d'un TimeControl (ex: "300+0" -> 300)
   */
  extractBaseTimeFromTimeControl(timeControl) {

    const match = timeControl.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }
  /**
   * Critères de filtrage EVAL: basé sur ALL + contient des évaluations
   */
  shouldKeepGameEval(gameText) {

    return gameText.includes('[%eval ');
  }
}


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

#!/usr/bin/env node

import { parentPort } from 'worker_threads';
import { Chess } from 'chess.js';
import { createHash } from 'crypto';

/**
 * Worker pour traiter un batch de parties PGN et extraire les positions FEN
 */

const cityHash64 = (str) => {
  const hash = createHash('sha256').update(str).digest();
  return hash.readBigUInt64LE(0);
};

/**
 * Normalise un FEN pour ne garder que les 4 premiers champs
 */
function normalizeFen(fen) {
  const parts = fen.split(' ');
  parts[4] = '0';
  parts[5] = '1';
  return parts.join(' ');
}

const extractSource = (gameText) => {
  const match = gameText.match(/\[Source\s+"([^"]+)"\]/);
  return match ? match[1] : 'Unknown';
};

/**
 * Extrait le résultat d'une partie PGN
 */
function extractResult(gameText) {
  const match = gameText.match(/\s+(1-0|0-1|1\/2-1\/2|\*)\s*$/m);
  return match ? match[1] : null;
}

/**
 * Extrait l'ID nanoid d'une partie PGN
 */
function extractGameId(gameText) {
  const match = gameText.match(/\[ID\s+"([^"]+)"\]/);
  return match ? match[1] : null;
}

function extractWhiteElo(gameText) {
  const match = gameText.match(/\[WhiteElo\s+"([^"]+)"\]/);
  if (!match) return 0;
  const elo = parseInt(match[1]);
  return isNaN(elo) ? 0 : elo;
}

function extractSite(gameText) {
  const match = gameText.match(/\[Site\s+"([^"]+)"\]/);
  return match ? match[1] : null;
}

function extractDate(gameText) {
  const match = gameText.match(/\[Date\s+"([^"]+)"\]/);
  return match ? match[1] : '1900.01.01';
}

/**
 * Traite une partie PGN et retourne toutes les positions avec l'ID de la partie
 */
function processGame(gameText) {
  const positions = [];

  try {
    if (gameText.toLowerCase().includes('tcec')) {
      return positions;
    }

    const result = extractResult(gameText);
    if (!result || result === '*') {
      return positions;
    }

    const gameId = extractGameId(gameText);
    if (!gameId) {
      return positions;
    }

    const whiteElo = extractWhiteElo(gameText);
    const site = extractSite(gameText);
    const date = extractDate(gameText);
    const official = extractSource(gameText) === 'Official' ? 1 : 0;

    // Parser le PGN avec Chess.js
    const chess = new Chess();

    chess.loadPgn(gameText);
    const history = chess.history({ verbose: true });

    // Rejouer tous les coups pour obtenir toutes les positions
    const replayChess = new Chess();

    for (let i = 0; i < history.length; i++) {
      const currentFen = replayChess.fen();
      const normalizedFen = normalizeFen(currentFen);
      const hashFen = cityHash64(normalizedFen);
      positions.push({
        hashFen: hashFen.toString(),
        fen: normalizedFen,
        result: result,
        gameId: gameId,
        whiteElo: whiteElo,
        official: official,
        date: date
      });

      replayChess.move(history[i].san);
    }

    const finalFen = replayChess.fen();
    const normalizedFinalFen = normalizeFen(finalFen);
    const hashFinalFen = cityHash64(normalizedFinalFen);
    positions.push({
      hashFen: hashFinalFen.toString(),
      fen: normalizedFinalFen,
      result: result,
      gameId: gameId,
      whiteElo: whiteElo,
      official: official,
      date: date
    });

  } catch (error) {
    // Erreur lors du traitement, ignorer cette partie
    return positions;
  }

  return positions;
}

// Gestion d'erreur globale pour le worker
process.on('uncaughtException', (error) => {
  parentPort.postMessage({
    success: false,
    error: `Worker uncaughtException: ${error.message}`
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  parentPort.postMessage({
    success: false,
    error: `Worker unhandledRejection: ${reason.message || reason}`
  });
  process.exit(1);
});

// Écouter les messages du thread principal
parentPort.on('message', (data) => {
  try {
    const { games, batchId } = data;
    const allPositions = [];
    let processedGames = 0;

    // Traiter chaque partie du batch
    for (let i = 0; i < games.length; i++) {
      try {
        const gameText = games[i];

        if (!gameText || typeof gameText !== 'string') {
          continue;
        }

        const positions = processGame(gameText);
        allPositions.push(...positions);
        processedGames++;

      } catch (gameError) {
        // Continuer avec la partie suivante
      }
    }

    // Retourner le résultat final
    parentPort.postMessage({
      success: true,
      result: {
        positions: allPositions,
        processedGames: processedGames,
        batchId: batchId
      }
    });

  } catch (error) {
    // Retourner l'erreur
    parentPort.postMessage({
      success: false,
      error: error.message
    });
  }
});

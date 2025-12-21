#!/usr/bin/env node

import { parentPort } from 'worker_threads'
import { Chess } from 'chess.js'
import { createHash } from 'crypto'

const cityHash64 = (str) => {
  const hash = createHash('sha256').update(str).digest()
  return hash.readBigUInt64LE(0)
}

const normalizeFen = (fen) => {
  const parts = fen.split(' ')
  parts[4] = '0'
  parts[5] = '1'
  return parts.join(' ')
}

const isOfficialSource = (site, pgn) => {
  const officialSources = ['TWIC', 'PGNMentor', 'twic', 'pgnmentor']
  return officialSources.some(source =>
    site?.toLowerCase().includes(source.toLowerCase()) ||
    pgn.toLowerCase().includes(source.toLowerCase())
  )
}

const parseGameHeaders = (line) => {
  const idMatch = line.match(/\[ID "([^"]+)"\]/)
  if (!idMatch) return null

  return {
    id: idMatch[1],
    whiteElo: 0,
    result: null,
    site: null,
    date: '1900.01.01'
  }
}

const parseAdditionalHeader = (game, line) => {
  const patterns = {
    whiteElo: /\[WhiteElo "([^"]+)"\]/,
    result: /\[Result "([^"]+)"\]/,
    site: /\[Site "([^"]+)"\]/,
    date: /\[Date "([^"]+)"\]/
  }

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = line.match(pattern)
    if (match) {
      if (key === 'whiteElo') {
        const elo = parseInt(match[1])
        game[key] = isNaN(elo) ? 0 : elo
      } else {
        game[key] = match[1]
      }
      break
    }
  }
}

const processGame = (game, pgn) => {
  if (!game.id || pgn.toLowerCase().includes('tcec')) {
    return []
  }

  const official = isOfficialSource(game.site, pgn) ? 1 : 0
  const positions = []

  try {
    const chess = new Chess()
    chess.loadPgn(pgn)
    const history = chess.history({ verbose: true })

    const replayChess = new Chess()

    for (let i = 0; i < history.length; i++) {
      const currentFen = replayChess.fen()
      const normalizedFen = normalizeFen(currentFen)
      const hashFen = cityHash64(normalizedFen)

      positions.push({
        hashFen: hashFen.toString(),
        fen: normalizedFen,
        gameId: game.id,
        whiteElo: game.whiteElo,
        official,
        date: game.date
      })

      replayChess.move(history[i].san)
    }

    const finalFen = replayChess.fen()
    const normalizedFinalFen = normalizeFen(finalFen)
    const hashFinalFen = cityHash64(normalizedFinalFen)
    positions.push({
      hashFen: hashFinalFen.toString(),
      fen: normalizedFinalFen,
      gameId: game.id,
      whiteElo: game.whiteElo,
      official,
      date: game.date
    })
  } catch (error) {
  }

  return positions
}

parentPort.on('message', (data) => {
  try {
    const { games, batchId } = data
    const allPositions = []
    let processedGames = 0

    for (const pgn of games) {
      const lines = pgn.split('\n')
      let currentGame = null

      for (const line of lines) {
        if (line.startsWith('[ID ')) {
          currentGame = parseGameHeaders(line)
          if (!currentGame) break
        } else if (currentGame && line.startsWith('[')) {
          parseAdditionalHeader(currentGame, line)
        }
      }

      if (currentGame) {
        const positions = processGame(currentGame, pgn)
        allPositions.push(...positions)
        processedGames++
      }
    }

    parentPort.postMessage({
      success: true,
      result: {
        positions: allPositions,
        processedGames,
        batchId
      }
    })
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error.message
    })
  }
})

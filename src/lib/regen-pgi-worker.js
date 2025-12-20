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
    const moves = pgn.match(/\d+\.\s*([^\s]+)(?:\s+([^\s]+))?/g) || []

    for (const moveText of moves) {
      const parts = moveText.match(/\d+\.\s*([^\s]+)(?:\s+([^\s]+))?/)
      if (!parts) continue

      for (let i = 1; i <= 2; i++) {
        const move = parts[i]
        if (!move || move === '1-0' || move === '0-1' || move === '1/2-1/2') break

        try {
          chess.move(move)
          const fen = normalizeFen(chess.fen())
          const hashFen = cityHash64(fen)

          positions.push({
            hashFen: hashFen.toString(),
            fen,
            gameId: game.id,
            whiteElo: game.whiteElo,
            official,
            date: game.date
          })
        } catch (e) {
        }
      }
    }
  } catch (error) {
  }

  return positions
}

parentPort.on('message', (data) => {
  try {
    const { pgnLines, batchId } = data
    const allPositions = []
    let processedGames = 0

    let currentGame = null
    let currentPgn = ''
    let inGame = false

    for (const line of pgnLines) {
      if (line.startsWith('[ID ')) {
        if (currentGame && inGame) {
          const positions = processGame(currentGame, currentPgn)
          allPositions.push(...positions)
          processedGames++
        }

        currentGame = parseGameHeaders(line)
        if (!currentGame) continue
        currentPgn = line + '\n'
        inGame = true
      } else if (inGame) {
        currentPgn += line + '\n'

        if (line.startsWith('[')) {
          parseAdditionalHeader(currentGame, line)
        }
      }
    }

    if (currentGame && inGame) {
      const positions = processGame(currentGame, currentPgn)
      allPositions.push(...positions)
      processedGames++
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

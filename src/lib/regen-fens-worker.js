#!/usr/bin/env node

import { parentPort } from 'worker_threads'
import { createHash } from 'crypto'

const cityHash64 = (str) => {
  const hash = createHash('sha256').update(str).digest()
  return hash.readBigUInt64LE(0)
}

parentPort.on('message', (data) => {
  try {
    const { lines, batchId } = data
    const processedLines = []

    for (const line of lines) {
      const columns = line.split('\t')
      if (columns.length < 2) continue

      const fen = columns[0]
      const hashFen = cityHash64(fen)
      processedLines.push(`${hashFen}\t${line}`)
    }

    parentPort.postMessage({
      success: true,
      result: {
        lines: processedLines,
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

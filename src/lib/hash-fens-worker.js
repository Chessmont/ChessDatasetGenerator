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
    const hashedLines = []

    for (const line of lines) {
      const fen = line.split('\t')[0]
      const hashFen = cityHash64(fen)
      hashedLines.push(`${hashFen.toString()}\t${line}`)
    }

    parentPort.postMessage({
      success: true,
      result: {
        lines: hashedLines,
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

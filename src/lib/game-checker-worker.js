import { parentPort } from 'worker_threads';
import { Chess } from 'chess.js';

/**
 * Worker pour valider les parties PGN en parallèle - VERSION SIMPLE
 */

const chess = new Chess();

function testGame(gameText) {
    try {
        chess.reset();
        chess.loadPgn(gameText);
        return { valid: true };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

parentPort.on('message', ({ batch, batchId }) => {
    try {
        const result = {
            batchId,
            totalGames: 0,
            validGames: 0,
            invalidGames: 0,
            errors: {},
            validResults: [],
            invalidResults: []
        };

        for (const gameText of batch) {
            result.totalGames++;

            const testResult = testGame(gameText);

            if (testResult.valid) {
                result.validGames++;
                result.validResults.push(gameText);
            } else {
                result.invalidGames++;
                result.invalidResults.push({
                    gameText,
                    error: testResult.error
                });

                const errorType = testResult.error.split(':')[0];
                result.errors[errorType] = (result.errors[errorType] || 0) + 1;
            }
        }

        parentPort.postMessage({ success: true, result });
    } catch (error) {
        parentPort.postMessage({
            success: false,
            error: error.message,
            batchId
        });
    }
});

#!/usr/bin/env node

import { Worker } from 'worker_threads';
import { cpus } from 'os';

class WorkerPool {  constructor(workerScript, poolSize = null) {
    this.workerScript = workerScript;
    this.poolSize = poolSize || Math.max(1, cpus().length);
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.activeTasksCount = 0;
    this.isShuttingDown = false;

    this.createWorkers();
  }

  createWorkers() {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(this.workerScript);
      worker.workerId = i;
      worker.isAvailable = true;
      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }
  }

  async execute(taskData) {
    return new Promise((resolve, reject) => {
      const task = { data: taskData, resolve, reject };

      if (this.isShuttingDown) {
        reject(new Error('Worker pool is shutting down'));
        return;
      }

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  processQueue() {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }

    const task = this.taskQueue.shift();
    const worker = this.availableWorkers.shift();

    worker.isAvailable = false;
    this.activeTasksCount++;

    // Gérer la réponse du worker
    const messageHandler = (message) => {
      worker.off('message', messageHandler);
      worker.off('error', errorHandler);

      // Remettre le worker disponible
      worker.isAvailable = true;
      this.availableWorkers.push(worker);
      this.activeTasksCount--;

      if (message.success) {
        task.resolve(message.result);
      } else {
        task.reject(new Error(message.error));
      }

      // Traiter la prochaine tâche
      this.processQueue();
    };

    const errorHandler = (error) => {
      worker.off('message', messageHandler);
      worker.off('error', errorHandler);

      // Remettre le worker disponible
      worker.isAvailable = true;
      this.availableWorkers.push(worker);
      this.activeTasksCount--;

      task.reject(error);

      // Traiter la prochaine tâche
      this.processQueue();
    };

    worker.on('message', messageHandler);
    worker.on('error', errorHandler);

    // Envoyer la tâche au worker
    worker.postMessage(task.data);
  }

  /**
   * Attend que toutes les tâches en cours se terminent
   */
  async waitForCompletion() {
    return new Promise((resolve) => {
      const checkCompletion = () => {
        if (this.activeTasksCount === 0 && this.taskQueue.length === 0) {
          resolve();
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
  }

  /**
   * Ferme le pool de workers
   */
  async shutdown() {
    this.isShuttingDown = true;

    // Attendre que toutes les tâches se terminent
    await this.waitForCompletion();

    // Terminer tous les workers
    const shutdownPromises = this.workers.map(worker => {
      return worker.terminate();
    });

    await Promise.all(shutdownPromises);
  }

  /**
   * Statistiques du pool
   */
  getStats() {
    return {
      poolSize: this.poolSize,
      availableWorkers: this.availableWorkers.length,
      activeTasks: this.activeTasksCount,
      queuedTasks: this.taskQueue.length
    };
  }
}

export default WorkerPool;

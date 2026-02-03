export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize telemetry (only in production or if explicitly enabled in dev)
    if (!(process.env.NODE_ENV !== 'production' && !process.env.ENABLE_TELEMETRY_IN_DEV)) {
      if (process.env.ENABLE_TELEMETRY) {
        await import('./instrumentation.node');
      }
    }

    // Start trigger queue worker in database mode (unless explicitly disabled)
    // This enables automatic processing of webhook triggers and cron jobs
    const shouldStartWorker =
      process.env.DATABASE_DRIVER === 'node' && process.env.START_WORKER !== 'false';

    if (shouldStartWorker) {
      const { triggerQueueWorker } = await import('./server/workers/triggerQueueWorker');
      triggerQueueWorker.start().catch((error) => {
        console.error('Failed to start trigger queue worker:', error);
      });
    }
  }
}

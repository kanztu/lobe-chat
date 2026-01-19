export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize telemetry
    if (process.env.ENABLE_TELEMETRY) {
      await import('./instrumentation.node');
    }

    // Start trigger queue worker if enabled
    if (process.env.START_WORKER === 'true') {
      const { triggerQueueWorker } = await import('./server/workers/triggerQueueWorker');
      triggerQueueWorker.start().catch((error) => {
        console.error('Failed to start trigger queue worker:', error);
      });
    }
  }
}

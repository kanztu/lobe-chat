# Vector Re-embedding Service Design

**Parent Design**: [2025-01-17-memory-backup-design.md](./2025-01-17-memory-backup-design.md)
**Date**: 2025-01-17
**Purpose**: Phase 3 implementation - Automatic vector regeneration after import
**Status**: Future Enhancement

## Overview

When user memory and RAG data are imported without vectors, this service automatically regenerates the embeddings using the existing embedding infrastructure.

## Problem

User memories and RAG chunks have been imported but lack vector embeddings:
- `userMemories`: missing `summaryVector1024`, `detailsVector1024`
- `userMemoriesContexts`: missing `descriptionVector`
- `userMemoriesPreferences`: missing `conclusionDirectivesVector`
- `userMemoriesIdentities`: missing `descriptionVector`
- `userMemoriesExperiences`: missing `situationVector`, `actionVector`, `keyLearningVector`
- `chunks`: missing `embedding`
- `unstructuredChunks`: missing `embedding`
- `documentChunks`: missing `embedding`

Without vectors, semantic search doesn't work for imported data.

## Design Goals

1. **Automatic**: Trigger re-embedding immediately after successful import
2. **Asynchronous**: Don't block import completion
3. **Progressive**: Show real-time progress to user
4. **Resumable**: Handle failures and allow retry
5. **Cost-aware**: Batch requests, rate limit, estimate costs
6. **Prioritized**: Re-embed critical data first (memories > RAG chunks)

## Architecture

### Service Structure

```typescript
// src/server/services/reembedding/ReembeddingService.ts

interface ReembeddingJob {
  id: string;
  userId: string;
  type: 'memories' | 'rag';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  estimatedCost: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

interface ReembeddingProgress {
  memories: {
    total: number;
    completed: number;
    failed: number;
  };
  rag: {
    total: number;
    completed: number;
    failed: number;
  };
  overall: {
    status: 'idle' | 'processing' | 'completed' | 'failed';
    progress: number;  // 0-100
    estimatedTimeRemaining: number;  // seconds
    estimatedCost: number;  // USD
  };
}

export class ReembeddingService {
  constructor(
    private db: LobeChatDatabase,
    private embeddingService: EmbeddingService,
    private userId: string,
  ) {}

  /**
   * Start re-embedding all missing vectors for a user
   */
  async startReembedding(): Promise<string> {
    const jobId = uuid();

    // Count items needing re-embedding
    const memoryCounts = await this.countMissingMemoryVectors();
    const ragCounts = await this.countMissingRagVectors();

    // Create job record
    const job: ReembeddingJob = {
      id: jobId,
      userId: this.userId,
      type: 'memories',  // Start with memories (higher priority)
      status: 'pending',
      total: memoryCounts.total,
      completed: 0,
      failed: 0,
      estimatedCost: this.estimateCost(memoryCounts.total + ragCounts.total),
    };

    await this.saveJob(job);

    // Start async processing
    this.processReembedding(jobId).catch(console.error);

    return jobId;
  }

  /**
   * Get current re-embedding progress
   */
  async getProgress(): Promise<ReembeddingProgress> {
    const jobs = await this.getActiveJobs();

    const memoryJob = jobs.find(j => j.type === 'memories');
    const ragJob = jobs.find(j => j.type === 'rag');

    const totalCompleted = (memoryJob?.completed || 0) + (ragJob?.completed || 0);
    const totalItems = (memoryJob?.total || 0) + (ragJob?.total || 0);
    const progress = totalItems > 0 ? (totalCompleted / totalItems) * 100 : 0;

    return {
      memories: {
        total: memoryJob?.total || 0,
        completed: memoryJob?.completed || 0,
        failed: memoryJob?.failed || 0,
      },
      rag: {
        total: ragJob?.total || 0,
        completed: ragJob?.completed || 0,
        failed: ragJob?.failed || 0,
      },
      overall: {
        status: this.determineOverallStatus(jobs),
        progress,
        estimatedTimeRemaining: this.estimateTimeRemaining(totalItems - totalCompleted),
        estimatedCost: (memoryJob?.estimatedCost || 0) + (ragJob?.estimatedCost || 0),
      },
    };
  }

  /**
   * Process re-embedding job
   */
  private async processReembedding(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    try {
      await this.updateJob(jobId, { status: 'processing', startedAt: new Date() });

      if (job.type === 'memories') {
        await this.reembedMemories(jobId);

        // After memories, start RAG re-embedding
        const ragCounts = await this.countMissingRagVectors();
        if (ragCounts.total > 0) {
          const ragJobId = uuid();
          await this.saveJob({
            id: ragJobId,
            userId: this.userId,
            type: 'rag',
            status: 'pending',
            total: ragCounts.total,
            completed: 0,
            failed: 0,
            estimatedCost: this.estimateCost(ragCounts.total),
          });
          await this.processReembedding(ragJobId);
        }
      } else {
        await this.reembedRAG(jobId);
      }

      await this.updateJob(jobId, {
        status: 'completed',
        completedAt: new Date(),
      });
    } catch (error) {
      console.error(`Re-embedding job ${jobId} failed:`, error);
      await this.updateJob(jobId, {
        status: 'failed',
        error: (error as Error).message,
      });
    }
  }

  /**
   * Re-embed all user memories
   */
  private async reembedMemories(jobId: string): Promise<void> {
    const BATCH_SIZE = 10;

    // Process each memory table
    await this.reembedUserMemories(jobId, BATCH_SIZE);
    await this.reembedUserMemoriesContexts(jobId, BATCH_SIZE);
    await this.reembedUserMemoriesPreferences(jobId, BATCH_SIZE);
    await this.reembedUserMemoriesIdentities(jobId, BATCH_SIZE);
    await this.reembedUserMemoriesExperiences(jobId, BATCH_SIZE);
  }

  /**
   * Re-embed userMemories table (2 vectors per row)
   */
  private async reembedUserMemories(jobId: string, batchSize: number): Promise<void> {
    const memories = await this.db.query.userMemories.findMany({
      where: and(
        eq(userMemories.userId, this.userId),
        or(
          isNull(userMemories.summaryVector1024),
          isNull(userMemories.detailsVector1024)
        )
      ),
      limit: 1000,  // Process max 1000 at a time
    });

    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (memory) => {
          try {
            const updates: any = {};

            // Re-embed summary if missing
            if (!memory.summaryVector1024 && memory.summary) {
              const embedding = await this.embeddingService.embed(memory.summary);
              updates.summaryVector1024 = embedding;
            }

            // Re-embed details if missing
            if (!memory.detailsVector1024 && memory.details) {
              const embedding = await this.embeddingService.embed(memory.details);
              updates.detailsVector1024 = embedding;
            }

            // Update database
            if (Object.keys(updates).length > 0) {
              await this.db
                .update(userMemories)
                .set(updates)
                .where(eq(userMemories.id, memory.id));
            }

            // Update progress
            await this.incrementJobProgress(jobId, 1);
          } catch (error) {
            console.error(`Failed to re-embed memory ${memory.id}:`, error);
            await this.incrementJobFailed(jobId, 1);
          }
        })
      );

      // Rate limiting: wait 100ms between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Re-embed userMemoriesContexts table (1 vector per row)
   */
  private async reembedUserMemoriesContexts(jobId: string, batchSize: number): Promise<void> {
    const contexts = await this.db.query.userMemoriesContexts.findMany({
      where: and(
        eq(userMemoriesContexts.userId, this.userId),
        isNull(userMemoriesContexts.descriptionVector)
      ),
      limit: 1000,
    });

    for (let i = 0; i < contexts.length; i += batchSize) {
      const batch = contexts.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (context) => {
          try {
            if (context.description) {
              const embedding = await this.embeddingService.embed(context.description);

              await this.db
                .update(userMemoriesContexts)
                .set({ descriptionVector: embedding })
                .where(eq(userMemoriesContexts.id, context.id));
            }

            await this.incrementJobProgress(jobId, 1);
          } catch (error) {
            console.error(`Failed to re-embed context ${context.id}:`, error);
            await this.incrementJobFailed(jobId, 1);
          }
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Re-embed userMemoriesPreferences table (1 vector per row)
   */
  private async reembedUserMemoriesPreferences(jobId: string, batchSize: number): Promise<void> {
    const preferences = await this.db.query.userMemoriesPreferences.findMany({
      where: and(
        eq(userMemoriesPreferences.userId, this.userId),
        isNull(userMemoriesPreferences.conclusionDirectivesVector)
      ),
      limit: 1000,
    });

    for (let i = 0; i < preferences.length; i += batchSize) {
      const batch = preferences.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (pref) => {
          try {
            if (pref.conclusionDirectives) {
              const embedding = await this.embeddingService.embed(pref.conclusionDirectives);

              await this.db
                .update(userMemoriesPreferences)
                .set({ conclusionDirectivesVector: embedding })
                .where(eq(userMemoriesPreferences.id, pref.id));
            }

            await this.incrementJobProgress(jobId, 1);
          } catch (error) {
            console.error(`Failed to re-embed preference ${pref.id}:`, error);
            await this.incrementJobFailed(jobId, 1);
          }
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Re-embed userMemoriesIdentities table (1 vector per row)
   */
  private async reembedUserMemoriesIdentities(jobId: string, batchSize: number): Promise<void> {
    const identities = await this.db.query.userMemoriesIdentities.findMany({
      where: and(
        eq(userMemoriesIdentities.userId, this.userId),
        isNull(userMemoriesIdentities.descriptionVector)
      ),
      limit: 1000,
    });

    for (let i = 0; i < identities.length; i += batchSize) {
      const batch = identities.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (identity) => {
          try {
            if (identity.description) {
              const embedding = await this.embeddingService.embed(identity.description);

              await this.db
                .update(userMemoriesIdentities)
                .set({ descriptionVector: embedding })
                .where(eq(userMemoriesIdentities.id, identity.id));
            }

            await this.incrementJobProgress(jobId, 1);
          } catch (error) {
            console.error(`Failed to re-embed identity ${identity.id}:`, error);
            await this.incrementJobFailed(jobId, 1);
          }
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Re-embed userMemoriesExperiences table (3 vectors per row)
   */
  private async reembedUserMemoriesExperiences(jobId: string, batchSize: number): Promise<void> {
    const experiences = await this.db.query.userMemoriesExperiences.findMany({
      where: and(
        eq(userMemoriesExperiences.userId, this.userId),
        or(
          isNull(userMemoriesExperiences.situationVector),
          isNull(userMemoriesExperiences.actionVector),
          isNull(userMemoriesExperiences.keyLearningVector)
        )
      ),
      limit: 1000,
    });

    for (let i = 0; i < experiences.length; i += batchSize) {
      const batch = experiences.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (exp) => {
          try {
            const updates: any = {};

            if (!exp.situationVector && exp.situation) {
              updates.situationVector = await this.embeddingService.embed(exp.situation);
            }

            if (!exp.actionVector && exp.action) {
              updates.actionVector = await this.embeddingService.embed(exp.action);
            }

            if (!exp.keyLearningVector && exp.keyLearning) {
              updates.keyLearningVector = await this.embeddingService.embed(exp.keyLearning);
            }

            if (Object.keys(updates).length > 0) {
              await this.db
                .update(userMemoriesExperiences)
                .set(updates)
                .where(eq(userMemoriesExperiences.id, exp.id));
            }

            await this.incrementJobProgress(jobId, 1);
          } catch (error) {
            console.error(`Failed to re-embed experience ${exp.id}:`, error);
            await this.incrementJobFailed(jobId, 1);
          }
        })
      );

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Re-embed all RAG chunks
   */
  private async reembedRAG(jobId: string): Promise<void> {
    const BATCH_SIZE = 20;  // RAG can be batched larger

    await this.reembedChunks(jobId, BATCH_SIZE);
    await this.reembedUnstructuredChunks(jobId, BATCH_SIZE);
  }

  /**
   * Re-embed chunks table
   */
  private async reembedChunks(jobId: string, batchSize: number): Promise<void> {
    const chunks = await this.db.query.chunks.findMany({
      where: and(
        eq(chunks.userId, this.userId),
        isNull(chunks.embedding)
      ),
      limit: 5000,  // Process more RAG chunks at once
    });

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (chunk) => {
          try {
            if (chunk.text) {
              const embedding = await this.embeddingService.embed(chunk.text);

              await this.db
                .update(chunks)
                .set({ embedding })
                .where(eq(chunks.id, chunk.id));
            }

            await this.incrementJobProgress(jobId, 1);
          } catch (error) {
            console.error(`Failed to re-embed chunk ${chunk.id}:`, error);
            await this.incrementJobFailed(jobId, 1);
          }
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Re-embed unstructured chunks table
   */
  private async reembedUnstructuredChunks(jobId: string, batchSize: number): Promise<void> {
    const chunks = await this.db.query.unstructuredChunks.findMany({
      where: and(
        eq(unstructuredChunks.userId, this.userId),
        isNull(unstructuredChunks.embedding)
      ),
      limit: 5000,
    });

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (chunk) => {
          try {
            if (chunk.text) {
              const embedding = await this.embeddingService.embed(chunk.text);

              await this.db
                .update(unstructuredChunks)
                .set({ embedding })
                .where(eq(unstructuredChunks.id, chunk.id));
            }

            await this.incrementJobProgress(jobId, 1);
          } catch (error) {
            console.error(`Failed to re-embed unstructured chunk ${chunk.id}:`, error);
            await this.incrementJobFailed(jobId, 1);
          }
        })
      );

      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Count memories needing re-embedding
   */
  private async countMissingMemoryVectors(): Promise<{ total: number; byTable: Record<string, number> }> {
    const counts = await Promise.all([
      this.db.query.userMemories.findMany({
        where: and(
          eq(userMemories.userId, this.userId),
          or(isNull(userMemories.summaryVector1024), isNull(userMemories.detailsVector1024))
        ),
      }).then(r => ({ table: 'userMemories', count: r.length })),

      this.db.query.userMemoriesContexts.findMany({
        where: and(eq(userMemoriesContexts.userId, this.userId), isNull(userMemoriesContexts.descriptionVector)),
      }).then(r => ({ table: 'userMemoriesContexts', count: r.length })),

      this.db.query.userMemoriesPreferences.findMany({
        where: and(eq(userMemoriesPreferences.userId, this.userId), isNull(userMemoriesPreferences.conclusionDirectivesVector)),
      }).then(r => ({ table: 'userMemoriesPreferences', count: r.length })),

      this.db.query.userMemoriesIdentities.findMany({
        where: and(eq(userMemoriesIdentities.userId, this.userId), isNull(userMemoriesIdentities.descriptionVector)),
      }).then(r => ({ table: 'userMemoriesIdentities', count: r.length })),

      this.db.query.userMemoriesExperiences.findMany({
        where: and(
          eq(userMemoriesExperiences.userId, this.userId),
          or(
            isNull(userMemoriesExperiences.situationVector),
            isNull(userMemoriesExperiences.actionVector),
            isNull(userMemoriesExperiences.keyLearningVector)
          )
        ),
      }).then(r => ({ table: 'userMemoriesExperiences', count: r.length })),
    ]);

    const byTable: Record<string, number> = {};
    let total = 0;

    for (const { table, count } of counts) {
      byTable[table] = count;
      total += count;
    }

    return { total, byTable };
  }

  /**
   * Count RAG chunks needing re-embedding
   */
  private async countMissingRagVectors(): Promise<{ total: number; byTable: Record<string, number> }> {
    const counts = await Promise.all([
      this.db.query.chunks.findMany({
        where: and(eq(chunks.userId, this.userId), isNull(chunks.embedding)),
      }).then(r => ({ table: 'chunks', count: r.length })),

      this.db.query.unstructuredChunks.findMany({
        where: and(eq(unstructuredChunks.userId, this.userId), isNull(unstructuredChunks.embedding)),
      }).then(r => ({ table: 'unstructuredChunks', count: r.length })),
    ]);

    const byTable: Record<string, number> = {};
    let total = 0;

    for (const { table, count } of counts) {
      byTable[table] = count;
      total += count;
    }

    return { total, byTable };
  }

  /**
   * Estimate embedding cost (assumes OpenAI text-embedding-3-small pricing)
   */
  private estimateCost(totalItems: number): number {
    // Rough estimate: $0.00002 per 1K tokens
    // Average text = ~200 tokens per embedding
    // Average item = 2 embeddings (for memories)
    const avgTokensPerItem = 200 * 2;
    const totalTokens = (totalItems * avgTokensPerItem) / 1000;  // in thousands
    return totalTokens * 0.00002;
  }

  /**
   * Estimate time remaining (rough estimate)
   */
  private estimateTimeRemaining(remainingItems: number): number {
    // Rough estimate: 10 items per second (with rate limiting)
    return Math.ceil(remainingItems / 10);
  }

  /**
   * Helper methods for job management
   */
  private async saveJob(job: ReembeddingJob): Promise<void> {
    // Store in database or Redis
    // For now, could use asyncTasks table
  }

  private async getJob(jobId: string): Promise<ReembeddingJob | null> {
    // Retrieve from database
    return null;
  }

  private async updateJob(jobId: string, updates: Partial<ReembeddingJob>): Promise<void> {
    // Update job in database
  }

  private async getActiveJobs(): Promise<ReembeddingJob[]> {
    // Get all active jobs for this user
    return [];
  }

  private async incrementJobProgress(jobId: string, amount: number): Promise<void> {
    // Atomic increment of completed counter
  }

  private async incrementJobFailed(jobId: string, amount: number): Promise<void> {
    // Atomic increment of failed counter
  }

  private determineOverallStatus(jobs: ReembeddingJob[]): 'idle' | 'processing' | 'completed' | 'failed' {
    if (jobs.length === 0) return 'idle';
    if (jobs.some(j => j.status === 'processing')) return 'processing';
    if (jobs.some(j => j.status === 'failed')) return 'failed';
    if (jobs.every(j => j.status === 'completed')) return 'completed';
    return 'idle';
  }
}
```

## API Integration

### TRPC Router

```typescript
// src/server/routers/lambda/reembedding.ts

export const reembeddingRouter = router({
  /**
   * Start re-embedding after import
   */
  startReembedding: authedProcedure
    .use(serverDatabase)
    .mutation(async ({ ctx }) => {
      const service = new ReembeddingService(
        ctx.serverDB,
        ctx.embeddingService,
        ctx.userId
      );

      const jobId = await service.startReembedding();

      return { jobId, message: 'Re-embedding started' };
    }),

  /**
   * Get re-embedding progress
   */
  getProgress: authedProcedure
    .use(serverDatabase)
    .query(async ({ ctx }) => {
      const service = new ReembeddingService(
        ctx.serverDB,
        ctx.embeddingService,
        ctx.userId
      );

      return await service.getProgress();
    }),
});
```

### Import Integration

```typescript
// In importerRouter after successful import

importPgByPost: importProcedure
  .input(...)
  .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
    const result = await ctx.dataImporterService.importPgData(input);

    if (result.success) {
      // Trigger re-embedding
      const reembeddingService = new ReembeddingService(
        ctx.serverDB,
        ctx.embeddingService,
        ctx.userId
      );

      await reembeddingService.startReembedding();
    }

    return result;
  }),
```

## UI Components

### Progress Banner

```typescript
// src/features/Settings/features/BackupImport/ReembeddingProgress.tsx

export const ReembeddingProgress = () => {
  const { data: progress, isLoading } = trpc.reembedding.getProgress.useQuery(
    undefined,
    { refetchInterval: 2000 }  // Poll every 2 seconds
  );

  if (isLoading || !progress || progress.overall.status === 'idle') {
    return null;
  }

  return (
    <Alert
      type={progress.overall.status === 'completed' ? 'success' : 'info'}
      message={
        progress.overall.status === 'completed'
          ? 'Re-embedding complete! Semantic search is now available.'
          : `Re-indexing your memories and documents... ${progress.overall.progress.toFixed(0)}%`
      }
      description={
        <Space direction="vertical" style={{ width: '100%' }}>
          <Progress percent={progress.overall.progress} status="active" />

          <div>
            <Text type="secondary">
              Memories: {progress.memories.completed}/{progress.memories.total}
              {progress.memories.failed > 0 && ` (${progress.memories.failed} failed)`}
            </Text>
            <br />
            <Text type="secondary">
              Documents: {progress.rag.completed}/{progress.rag.total}
              {progress.rag.failed > 0 && ` (${progress.rag.failed} failed)`}
            </Text>
          </div>

          {progress.overall.status === 'processing' && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              Estimated time remaining: {Math.ceil(progress.overall.estimatedTimeRemaining / 60)} minutes
              <br />
              Estimated cost: ${progress.overall.estimatedCost.toFixed(4)}
            </Text>
          )}
        </Space>
      }
    />
  );
};
```

### Settings Integration

```typescript
// Add to Settings > Storage page

<ReembeddingProgress />
<BackupExportSection />
<BackupImportSection />
```

## Cost Estimation

### OpenAI text-embedding-3-small

- Price: $0.00002 per 1K tokens
- Typical memory: ~200 tokens per field
- Typical memory: 2 fields (summary + details) = 400 tokens

**Examples**:
- 100 memories: 40K tokens = **$0.0008**
- 1000 memories: 400K tokens = **$0.008**
- 10000 memories: 4M tokens = **$0.08**

Plus RAG chunks (usually more):
- 1000 chunks: 200K tokens = **$0.004**
- 10000 chunks: 2M tokens = **$0.04**

**Total for typical user** (1000 memories + 5000 chunks):
- ~1.4M tokens = **$0.028** (less than 3 cents)

## Performance Characteristics

### Processing Speed

- **Batch size**: 10 for memories (high quality), 20 for RAG (can be faster)
- **Rate limiting**: 100ms between batches (avoid API throttling)
- **Throughput**: ~10 items/second
- **1000 items**: ~100 seconds (~1.7 minutes)
- **10000 items**: ~1000 seconds (~17 minutes)

### Database Impact

- **Single row updates**: Minimal lock contention
- **Batch processing**: Spreads load over time
- **Index updates**: HNSW indexes rebuild incrementally

## Error Handling

### Retry Logic

```typescript
async embedWithRetry(text: string, maxRetries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this.embeddingService.embed(text);
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;

      // Exponential backoff
      await new Promise(resolve =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
  throw new Error('Failed after max retries');
}
```

### Failure Recovery

- **Failed items**: Logged but don't block progress
- **Resume capability**: Can restart from last checkpoint
- **Partial completion**: User can use memories that succeeded

## Testing

### Unit Tests

```typescript
describe('ReembeddingService', () => {
  it('should count missing vectors correctly', async () => {
    const counts = await service.countMissingMemoryVectors();
    expect(counts.total).toBeGreaterThan(0);
  });

  it('should re-embed memories successfully', async () => {
    const jobId = await service.startReembedding();

    // Wait for completion
    await waitForJobCompletion(jobId);

    // Verify vectors exist
    const memories = await db.query.userMemories.findMany();
    expect(memories.every(m => m.summaryVector1024 !== null)).toBe(true);
  });

  it('should handle embedding failures gracefully', async () => {
    // Mock embedding service to fail
    embeddingService.embed = jest.fn().mockRejectedValue(new Error('API error'));

    const jobId = await service.startReembedding();
    await waitForJobCompletion(jobId);

    const progress = await service.getProgress();
    expect(progress.memories.failed).toBeGreaterThan(0);
  });
});
```

### Integration Tests

```typescript
describe('Import + Re-embedding', () => {
  it('should automatically start re-embedding after import', async () => {
    // Import backup without vectors
    const importResult = await importerService.importPgData(backupData);
    expect(importResult.success).toBe(true);

    // Verify re-embedding started
    const progress = await reembeddingService.getProgress();
    expect(progress.overall.status).toBe('processing');
  });
});
```

## Security Considerations

1. **API Key Security**: Embedding service uses user's configured API key
2. **Rate Limiting**: Respects API provider's rate limits
3. **Cost Control**: Show estimated cost before starting
4. **Job Isolation**: Each user's re-embedding runs independently

## Monitoring

### Metrics to Track

- Re-embedding success rate
- Average time per item
- API error rates
- Cost per user
- Queue depth

### Logging

```typescript
console.log(`Re-embedding started for user ${userId}: ${total} items`);
console.log(`Progress: ${completed}/${total} (${failed} failed)`);
console.log(`Re-embedding completed in ${duration}ms, cost: $${cost}`);
```

## Summary

This design provides:
- ✅ **Automatic**: Triggers after import without user action
- ✅ **Transparent**: Real-time progress UI
- ✅ **Cost-effective**: ~$0.03 for typical user
- ✅ **Fast**: ~2 minutes for 1000 memories
- ✅ **Reliable**: Retry logic, error handling, resumable
- ✅ **Scalable**: Batch processing, rate limiting

Implementation can proceed with this design once Phase 1 and Phase 2 are complete.

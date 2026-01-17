# Memory & Complete Import Support Design

**Date**: 2025-01-17
**Status**: Design Phase
**Goal**: Add user memory to backup export and complete import configuration for all 40+ tables

## Problem Statement

Currently:
1. **User Memory Excluded**: All 5 user memory tables are excluded from backup due to vector embeddings
2. **Incomplete Import Config**: Import only supports ~15 tables, but export now has 40+ tables
3. **Missing Tables**: Files, documents, RAG evaluation, image generation, chat groups, and more

## Vector Data Challenge

### Memory Tables Have Heavy Vectors

Each user memory table contains multiple vector columns (1024 dimensions):

```typescript
// userMemories: 2 vectors per row
- summaryVector1024: vector(1024)
- detailsVector1024: vector(1024)

// userMemoriesContexts: 1 vector per row
- descriptionVector: vector(1024)

// userMemoriesPreferences: 1 vector per row
- conclusionDirectivesVector: vector(1024)

// userMemoriesIdentities: 1 vector per row
- descriptionVector: vector(1024)

// userMemoriesExperiences: 3 vectors per row
- situationVector: vector(1024)
- actionVector: vector(1024)
- keyLearningVector: vector(1024)
```

**Total**: 9 vector columns across 5 tables, each vector = 1024 floats = ~4KB

### Size Impact

Estimated size with 100 memories:
- userMemories: 100 rows × 2 vectors × 4KB = **800 KB**
- userMemoriesContexts: 100 rows × 1 vector × 4KB = **400 KB**
- userMemoriesPreferences: 100 rows × 1 vector × 4KB = **400 KB**
- userMemoriesIdentities: 100 rows × 1 vector × 4KB = **400 KB**
- userMemoriesExperiences: 100 rows × 3 vectors × 4KB = **1.2 MB**

**Total memory vectors**: ~3 MB for 100 memories
**With 1000 memories**: ~30 MB just for vectors

## Design Options

### Option 1: Export Memory WITHOUT Vectors (Recommended)

**Pros**:
- Much smaller backup size (text data only)
- Fast browser download
- Still preserves all memory content (title, summary, details, metadata)
- Vectors can be regenerated on import using embedding service

**Cons**:
- Requires re-embedding on import (API costs)
- Import takes longer (async re-embedding)
- Semantic search unavailable until re-embedding completes

**Implementation**:
```typescript
// Export without vector columns
const memoryWithoutVectors = {
  ...memory,
  summaryVector1024: undefined,  // Exclude from export
  detailsVector1024: undefined,   // Exclude from export
};

// On import, trigger async re-embedding
await embeddingService.reembedMemory(importedMemory.id);
```

### Option 2: Export Memory WITH Vectors

**Pros**:
- Complete backup (no data loss)
- Instant semantic search after import
- No re-embedding costs

**Cons**:
- 10-30x larger backup files
- Slow browser download (30MB+ for 1000 memories)
- May exceed browser memory limits

**Implementation**:
```typescript
// Export with vectors as base64 or float arrays
const memoryWithVectors = {
  ...memory,
  summaryVector1024: Array.from(memory.summaryVector1024),  // Float32Array → JSON
  detailsVector1024: Array.from(memory.detailsVector1024),
};
```

### Option 3: Configurable Export (User Choice)

**Pros**:
- Best of both worlds
- User decides based on their needs
- Advanced users can get full backup

**Cons**:
- More complex UI
- Two export paths to maintain
- User confusion about which to choose

**Implementation**:
```typescript
// UI offers two buttons
<Button onClick={() => exportBackup({ includeVectors: false })}>
  Quick Backup (Text Only)
</Button>
<Button onClick={() => exportBackup({ includeVectors: true })}>
  Complete Backup (With Vectors)
</Button>
```

## Recommended Approach: Option 1 + Future Enhancement

### Phase 1: Export Memory Without Vectors (Immediate)

1. **Add memory tables to export config** (text fields only)
2. **Strip vector columns** during export
3. **Fast, lightweight backups** for all users

### Phase 2: Add Re-embedding on Import (Future)

1. **Detect missing vectors** on import
2. **Queue async re-embedding jobs** using existing embedding service
3. **Show progress UI** "Re-indexing memories: 45/100"

### Phase 3: Optional Full Vector Export (Future)

1. **Add UI toggle** for advanced users
2. **Warn about file size** before export
3. **Use streaming export** for large files

## Import Configuration Strategy

### Current State

Only 15 tables configured in `IMPORT_TABLE_CONFIG`:
- userSettings
- userInstalledPlugins
- aiProviders
- aiModels
- sessionGroups
- agents
- sessions
- topics
- agentsToSessions
- threads
- messages
- messagePlugins
- messageChunks
- messageQueryChunks
- messageTranslates

### Missing Tables (25+ tables)

Need to add import config for:

**1. Agents & AI**
- agentsFiles
- agentsKnowledgeBases
- agentCronJobs
- chatGroups
- chatGroupsAgents

**2. Files & Documents**
- files
- documents
- knowledgeBases
- knowledgeBaseFiles
- fileChunks
- filesToSessions
- globalFiles (relation table)

**3. RAG System**
- chunks
- unstructuredChunks
- documentChunks

**4. RAG Evaluation**
- evalDatasets
- evalDatasetRecords
- evalEvaluation
- evaluationRecords

**5. Message Extensions**
- messageTTS
- messageQueries
- messagesFiles
- messageGroups

**6. User Memory (5 tables)**
- userMemories
- userMemoriesContexts
- userMemoriesPreferences
- userMemoriesIdentities
- userMemoriesExperiences

**7. Image Generation**
- generationTopics
- generationBatches
- generations

**8. Topic & Sharing**
- topicDocuments
- topicShares

**9. Authentication**
- account (Better-Auth)
- session (Better-Auth)
- passkey

**10. OIDC**
- oidcConsents

**11. RBAC**
- userRoles

**12. Tasks**
- asyncTasks

## Import Configuration Design

### Table Dependency Order

Tables must be imported in dependency order to maintain foreign key relationships:

```typescript
// Level 1: Base tables (no dependencies)
- userSettings
- userInstalledPlugins
- aiProviders

// Level 2: Provider-dependent
- aiModels (depends on aiProviders)

// Level 3: User content
- sessionGroups
- agents
- knowledgeBases
- evalDatasets
- generationTopics
- chatGroups

// Level 4: Relationships
- sessions (depends on sessionGroups)
- agentsKnowledgeBases (depends on agents, knowledgeBases)
- agentsFiles (depends on agents)
- chatGroupsAgents (depends on chatGroups, agents)
- agentCronJobs (depends on agents)

// Level 5: Files & Documents
- files
- documents (depends on files)
- knowledgeBaseFiles (depends on knowledgeBases, files)

// Level 6: Conversations
- topics (depends on sessions)
- threads (depends on topics)
- messages (depends on sessions, topics, agents, threads)

// Level 7: Message extensions
- messagePlugins (depends on messages)
- messageChunks (depends on messages)
- messageTranslates (depends on messages)
- messageTTS (depends on messages)
- messageQueries (depends on messages)
- messageQueryChunks (depends on messages, messageQueries)
- messagesFiles (depends on messages, files)
- messageGroups (depends on messages)

// Level 8: RAG
- chunks (depends on documents or other sources)
- unstructuredChunks
- documentChunks (depends on documents, chunks)
- fileChunks (depends on files, chunks)

// Level 9: User Memory
- userMemories
- userMemoriesContexts (depends on userMemories)
- userMemoriesPreferences (depends on userMemories)
- userMemoriesIdentities (depends on userMemories)
- userMemoriesExperiences (depends on userMemories)

// Level 10: Associations
- agentsToSessions (depends on agents, sessions)
- filesToSessions (depends on files, sessions)
- globalFiles (depends on files)

// Level 11: Evaluation & Sharing
- evalDatasetRecords (depends on evalDatasets)
- evalEvaluation (depends on evalDatasets)
- evaluationRecords (depends on evalEvaluation)
- topicDocuments (depends on topics, documents)
- topicShares (depends on topics)

// Level 12: Image Generation
- generationBatches (depends on generationTopics)
- generations (depends on generationBatches)

// Level 13: Auth & RBAC
- account (Better-Auth)
- session (Better-Auth)
- passkey
- oidcConsents
- userRoles

// Level 14: Tasks
- asyncTasks (may depend on various entities)
```

### Import Configuration Template

Each table needs:

```typescript
{
  table: 'tableName',

  // Preserve original IDs for key tables
  preserveId?: boolean,

  // Conflict resolution: skip/override/merge
  conflictStrategy: 'skip' | 'override' | 'merge',

  // Composite key tables (no separate id)
  isCompositeKey?: boolean,

  // Unique constraints for conflict detection
  uniqueConstraints: string[],

  // Foreign key relations (auto-remap IDs)
  relations: [
    { field: 'foreignKeyField', sourceTable: 'parentTable' }
  ],

  // Self-references (set to null on import)
  selfReferences?: [
    { field: 'parentId' }
  ],

  // Field processors (transform on import)
  fieldProcessors?: {
    slug: (value) => `${value}-${uuid().slice(0, 8)}`
  }
}
```

## Implementation Plan

### Phase 1: Add Memory Tables to Export (Without Vectors)

**Step 1**: Update `DATA_EXPORT_CONFIG`

```typescript
// User memory (without vectors for browser export)
{ table: 'userMemories' },
{ table: 'userMemoriesContexts' },
{ table: 'userMemoriesPreferences' },
{ table: 'userMemoriesIdentities' },
{ table: 'userMemoriesExperiences' },
```

**Step 2**: Add vector exclusion in `DataExporterRepos.export()`

```typescript
private removeVectorFields(tableName: string, data: any[]) {
  const vectorFieldsByTable: Record<string, string[]> = {
    userMemories: ['summaryVector1024', 'detailsVector1024'],
    userMemoriesContexts: ['descriptionVector'],
    userMemoriesPreferences: ['conclusionDirectivesVector'],
    userMemoriesIdentities: ['descriptionVector'],
    userMemoriesExperiences: ['situationVector', 'actionVector', 'keyLearningVector'],
    chunks: ['embedding'],
    unstructuredChunks: ['embedding'],
    documentChunks: ['embedding'],
  };

  const vectorFields = vectorFieldsByTable[tableName] || [];
  if (vectorFields.length === 0) return data;

  return data.map(row => {
    const cleaned = { ...row };
    vectorFields.forEach(field => {
      delete cleaned[field];
    });
    return cleaned;
  });
}
```

**Step 3**: Update README.md in backup ZIP

```markdown
## Excluded Data

The following data is excluded from browser exports to reduce file size:

### Vector Embeddings
- User memory vectors (summaryVector1024, detailsVector1024, etc.)
- RAG chunk embeddings
- Document embeddings

These will be automatically regenerated when you import this backup.
```

### Phase 2: Complete Import Configuration

**Step 1**: Add all missing tables to `IMPORT_TABLE_CONFIG` in dependency order

**Step 2**: Configure each table with:
- Conflict strategy (usually 'skip' for user content)
- Relations (foreign key mappings)
- Unique constraints
- Special processors if needed

**Step 3**: Add tests for each new table

### Phase 3: Re-embedding Service (Future)

**Step 1**: Create `ReembeddingService`

```typescript
class ReembeddingService {
  async reembedMemories(userId: string) {
    const memories = await db.query.userMemories.findMany({
      where: and(
        eq(userMemories.userId, userId),
        isNull(userMemories.summaryVector1024)
      )
    });

    for (const memory of memories) {
      await this.reembedMemory(memory);
    }
  }

  private async reembedMemory(memory: UserMemoryItem) {
    const summaryEmbedding = await embeddingService.embed(memory.summary);
    const detailsEmbedding = await embeddingService.embed(memory.details);

    await db.update(userMemories)
      .set({
        summaryVector1024: summaryEmbedding,
        detailsVector1024: detailsEmbedding,
      })
      .where(eq(userMemories.id, memory.id));
  }
}
```

**Step 2**: Hook into import completion

```typescript
// After import completes
const importResult = await dataImporter.importPgData(backupData);

if (importResult.success) {
  // Trigger async re-embedding
  await reembeddingService.reembedMemories(userId);
}
```

**Step 3**: Add progress UI

```typescript
// Real-time progress updates
const progress = await reembeddingService.getProgress(userId);
// { total: 100, completed: 45, status: 'reembedding' }
```

## Testing Strategy

### Export Tests

1. **Test memory export without vectors**
   - Verify vector fields are excluded
   - Verify text content is preserved
   - Verify relations are maintained

2. **Test file size**
   - Compare with/without vectors
   - Verify significant size reduction

### Import Tests

1. **Test each new table import**
   - Verify data integrity
   - Verify ID remapping works
   - Verify foreign keys are maintained

2. **Test import order**
   - Verify dependencies are resolved
   - Verify no foreign key violations

3. **Test conflict resolution**
   - Skip strategy: existing data preserved
   - Override strategy: new data replaces old
   - Merge strategy: fields updated

## Security Considerations

1. **Exclude sensitive data**
   - Two-factor secrets
   - API keys
   - Temporary tokens

2. **Encryption for vectors (future)**
   - If vectors are included, encrypt in ZIP
   - Require password for full backups

## Performance Considerations

1. **Memory export**
   - ~1-5 KB per memory (without vectors)
   - 1000 memories = ~1-5 MB

2. **Import batching**
   - Process 100 records at a time
   - Prevent memory exhaustion

3. **Re-embedding (future)**
   - Queue-based processing
   - Rate limiting for API calls
   - Background job system

## Documentation Updates

1. **User documentation**
   - What's included in backup
   - What's excluded and why
   - How to restore from backup

2. **Developer documentation**
   - How to add new tables to export
   - How to configure import
   - Vector handling strategy

## Success Criteria

✅ **Phase 1 Complete When**:
- All 5 user memory tables exported (without vectors)
- All 40+ tables have import configuration
- Tests pass for all new tables
- Backup/restore works end-to-end

✅ **Phase 2 Complete When** (Future):
- Re-embedding service implemented
- Progress UI shows re-embedding status
- Semantic search works after import

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Import fails due to missing dependencies | Strict dependency ordering in config |
| ID remapping breaks relations | Comprehensive ID map tracking |
| Vector regeneration costs high | Batch processing, user warning |
| Import timeout on large datasets | Chunked processing, progress tracking |

## Summary

This design provides:
1. ✅ **Immediate**: Memory backup without vectors (fast, lightweight)
2. ✅ **Complete**: All 40+ tables supported for import
3. 🔮 **Future**: Optional full vector export and auto re-embedding

The phased approach balances immediate user needs (complete backup/restore) with future enhancements (full fidelity with vectors).

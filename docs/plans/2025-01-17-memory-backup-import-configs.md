# Complete Import Configuration Reference

**Parent Design**: [2025-01-17-memory-backup-design.md](./2025-01-17-memory-backup-design.md)
**Date**: 2025-01-17
**Purpose**: Detailed import configurations for all 25+ missing tables

## Overview

This document provides the complete `IMPORT_TABLE_CONFIG` entries for all tables that are currently exported but lack import configuration.

## Current Import Config (Existing - 15 tables)

```typescript
const IMPORT_TABLE_CONFIG: TableImportConfig[] = [
  // ✅ Already configured
  { table: 'userSettings', preserveId: true, conflictStrategy: 'merge', uniqueConstraints: ['id'] },
  { table: 'userInstalledPlugins', isCompositeKey: true, conflictStrategy: 'merge', uniqueConstraints: ['identifier'] },
  { table: 'aiProviders', preserveId: true, conflictStrategy: 'skip', uniqueConstraints: ['id'] },
  { table: 'aiModels', preserveId: true, conflictStrategy: 'skip', relations: [{ field: 'providerId', sourceTable: 'aiProviders' }], uniqueConstraints: ['id', 'providerId'] },
  { table: 'sessionGroups', uniqueConstraints: [] },
  { table: 'agents', fieldProcessors: { slug: (v) => v ? `${v}-${uuid().slice(0, 8)}` : null }, uniqueConstraints: ['slug'] },
  { table: 'sessions', fieldProcessors: { slug: (v) => `${v}-${uuid().slice(0, 8)}` }, relations: [{ field: 'groupId', sourceTable: 'sessionGroups' }], uniqueConstraints: ['slug'] },
  { table: 'topics', relations: [{ field: 'sessionId', sourceTable: 'sessions' }] },
  { table: 'agentsToSessions', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'agentId', sourceTable: 'agents' }, { field: 'sessionId', sourceTable: 'sessions' }], uniqueConstraints: ['agentId', 'sessionId'] },
  { table: 'threads', relations: [{ field: 'topicId', sourceTable: 'topics' }], selfReferences: [{ field: 'parentThreadId' }] },
  { table: 'messages', relations: [{ field: 'sessionId', sourceTable: 'sessions' }, { field: 'topicId', sourceTable: 'topics' }, { field: 'agentId', sourceTable: 'agents' }, { field: 'threadId', sourceTable: 'threads' }], selfReferences: [{ field: 'parentId' }, { field: 'quotaId' }] },
  { table: 'messagePlugins', preserveId: true, conflictStrategy: 'skip', relations: [{ field: 'id', sourceTable: 'messages' }] },
  { table: 'messageChunks', isCompositeKey: true, relations: [{ field: 'messageId', sourceTable: 'messages' }, { field: 'chunkId', sourceTable: 'chunks' }] },
  { table: 'messageQueryChunks', isCompositeKey: true, relations: [{ field: 'id', sourceTable: 'messages' }, { field: 'queryId', sourceTable: 'messageQueries' }, { field: 'chunkId', sourceTable: 'chunks' }] },
  { table: 'messageTranslates', preserveId: true, conflictStrategy: 'skip', relations: [{ field: 'id', sourceTable: 'messages' }] },
];
```

## New Import Configs Needed (25+ tables)

### Level 4: Agent Relationships

```typescript
// agentsFiles
{
  table: 'agentsFiles',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'agentId', sourceTable: 'agents' },
    { field: 'fileId', sourceTable: 'files' },
  ],
  uniqueConstraints: ['agentId', 'fileId'],
},

// agentsKnowledgeBases
{
  table: 'agentsKnowledgeBases',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'agentId', sourceTable: 'agents' },
    { field: 'knowledgeBaseId', sourceTable: 'knowledgeBases' },
  ],
  uniqueConstraints: ['agentId', 'knowledgeBaseId'],
},

// agentCronJobs
{
  table: 'agentCronJobs',
  conflictStrategy: 'skip',
  relations: [
    { field: 'agentId', sourceTable: 'agents' },
  ],
  uniqueConstraints: [],
},
```

### Level 5: Files & Documents

```typescript
// files
{
  table: 'files',
  preserveId: false,  // Let system generate new IDs for files
  conflictStrategy: 'skip',
  uniqueConstraints: ['fileHash'],  // Dedupe by content hash
},

// documents
{
  table: 'documents',
  conflictStrategy: 'skip',
  relations: [
    { field: 'fileId', sourceTable: 'files' },
  ],
  uniqueConstraints: [],
},

// knowledgeBases
{
  table: 'knowledgeBases',
  conflictStrategy: 'skip',
  uniqueConstraints: ['name'],  // Dedupe by name per user
},

// knowledgeBaseFiles
{
  table: 'knowledgeBaseFiles',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'knowledgeBaseId', sourceTable: 'knowledgeBases' },
    { field: 'fileId', sourceTable: 'files' },
  ],
  uniqueConstraints: ['knowledgeBaseId', 'fileId'],
},
```

### Level 7: Message Extensions (Additional)

```typescript
// messageTTS
{
  table: 'messageTTS',
  preserveId: true,  // Uses message ID as primary key
  conflictStrategy: 'skip',
  relations: [
    { field: 'id', sourceTable: 'messages' },
  ],
  uniqueConstraints: ['id'],
},

// messageQueries
{
  table: 'messageQueries',
  conflictStrategy: 'skip',
  relations: [
    { field: 'messageId', sourceTable: 'messages' },
  ],
  uniqueConstraints: [],
},

// messagesFiles
{
  table: 'messagesFiles',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'messageId', sourceTable: 'messages' },
    { field: 'fileId', sourceTable: 'files' },
  ],
  uniqueConstraints: ['messageId', 'fileId'],
},

// messageGroups
{
  table: 'messageGroups',
  conflictStrategy: 'skip',
  relations: [
    { field: 'messageId', sourceTable: 'messages' },
  ],
  uniqueConstraints: [],
},
```

### Level 8: RAG System

```typescript
// chunks (base RAG chunks)
{
  table: 'chunks',
  conflictStrategy: 'skip',
  relations: [
    { field: 'fileId', sourceTable: 'files' },
    { field: 'documentId', sourceTable: 'documents' },
  ],
  uniqueConstraints: [],
  // Note: embedding vectors excluded from export, will be regenerated
},

// unstructuredChunks
{
  table: 'unstructuredChunks',
  conflictStrategy: 'skip',
  relations: [
    { field: 'fileId', sourceTable: 'files' },
  ],
  uniqueConstraints: [],
},

// documentChunks
{
  table: 'documentChunks',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'documentId', sourceTable: 'documents' },
    { field: 'chunkId', sourceTable: 'chunks' },
  ],
  uniqueConstraints: ['documentId', 'chunkId'],
},

// fileChunks
{
  table: 'fileChunks',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'fileId', sourceTable: 'files' },
    { field: 'chunkId', sourceTable: 'chunks' },
  ],
  uniqueConstraints: ['fileId', 'chunkId'],
},
```

### Level 9: User Memory (5 tables)

```typescript
// userMemories (base memory table)
{
  table: 'userMemories',
  conflictStrategy: 'skip',
  uniqueConstraints: [],
  // Note: summaryVector1024 and detailsVector1024 excluded from export
  // Will need re-embedding after import via async job
},

// userMemoriesContexts
{
  table: 'userMemoriesContexts',
  conflictStrategy: 'skip',
  relations: [
    // Note: userMemoryIds is a JSONB array, not a direct FK
    // Relations handled in application logic, not DB constraints
  ],
  uniqueConstraints: [],
  // Note: descriptionVector excluded from export
},

// userMemoriesPreferences
{
  table: 'userMemoriesPreferences',
  conflictStrategy: 'skip',
  relations: [
    { field: 'userMemoryId', sourceTable: 'userMemories' },
  ],
  uniqueConstraints: [],
  // Note: conclusionDirectivesVector excluded from export
},

// userMemoriesIdentities
{
  table: 'userMemoriesIdentities',
  conflictStrategy: 'skip',
  relations: [
    { field: 'userMemoryId', sourceTable: 'userMemories' },
  ],
  uniqueConstraints: [],
  // Note: descriptionVector excluded from export
},

// userMemoriesExperiences
{
  table: 'userMemoriesExperiences',
  conflictStrategy: 'skip',
  relations: [
    { field: 'userMemoryId', sourceTable: 'userMemories' },
  ],
  uniqueConstraints: [],
  // Note: situationVector, actionVector, keyLearningVector excluded from export
},
```

### Level 10: Additional Associations

```typescript
// filesToSessions
{
  table: 'filesToSessions',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'fileId', sourceTable: 'files' },
    { field: 'sessionId', sourceTable: 'sessions' },
  ],
  uniqueConstraints: ['fileId', 'sessionId'],
},

// globalFiles (file hash index)
{
  table: 'globalFiles',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'hashId', sourceTable: 'files', sourceField: 'fileHash' },
  ],
  uniqueConstraints: ['hashId'],
},
```

### Level 11: RAG Evaluation & Sharing

```typescript
// evalDatasets
{
  table: 'evalDatasets',
  conflictStrategy: 'skip',
  uniqueConstraints: ['name'],  // Dedupe by dataset name
},

// evalDatasetRecords
{
  table: 'evalDatasetRecords',
  conflictStrategy: 'skip',
  relations: [
    { field: 'datasetId', sourceTable: 'evalDatasets' },
  ],
  uniqueConstraints: [],
},

// evalEvaluation
{
  table: 'evalEvaluation',
  conflictStrategy: 'skip',
  relations: [
    { field: 'datasetId', sourceTable: 'evalDatasets' },
  ],
  uniqueConstraints: [],
},

// evaluationRecords
{
  table: 'evaluationRecords',
  conflictStrategy: 'skip',
  relations: [
    { field: 'evaluationId', sourceTable: 'evalEvaluation' },
    { field: 'recordId', sourceTable: 'evalDatasetRecords' },
  ],
  uniqueConstraints: [],
},

// topicDocuments
{
  table: 'topicDocuments',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'topicId', sourceTable: 'topics' },
    { field: 'documentId', sourceTable: 'documents' },
  ],
  uniqueConstraints: ['topicId', 'documentId'],
},

// topicShares
{
  table: 'topicShares',
  conflictStrategy: 'skip',
  relations: [
    { field: 'topicId', sourceTable: 'topics' },
  ],
  uniqueConstraints: ['shareToken'],  // Dedupe by share token
},
```

### Level 12: Image Generation

```typescript
// generationTopics
{
  table: 'generationTopics',
  conflictStrategy: 'skip',
  uniqueConstraints: [],
},

// generationBatches
{
  table: 'generationBatches',
  conflictStrategy: 'skip',
  relations: [
    { field: 'topicId', sourceTable: 'generationTopics' },
  ],
  uniqueConstraints: [],
},

// generations
{
  table: 'generations',
  conflictStrategy: 'skip',
  relations: [
    { field: 'batchId', sourceTable: 'generationBatches' },
  ],
  uniqueConstraints: [],
},
```

### Level 13: Chat Groups

```typescript
// chatGroups
{
  table: 'chatGroups',
  conflictStrategy: 'skip',
  uniqueConstraints: ['name'],  // Dedupe by group name per user
},

// chatGroupsAgents
{
  table: 'chatGroupsAgents',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  relations: [
    { field: 'chatGroupId', sourceTable: 'chatGroups' },
    { field: 'agentId', sourceTable: 'agents' },
  ],
  uniqueConstraints: ['chatGroupId', 'agentId'],
},
```

### Level 14: Authentication (Better-Auth)

```typescript
// account (Better-Auth accounts)
{
  table: 'account',
  conflictStrategy: 'skip',
  uniqueConstraints: ['providerId', 'accountId'],  // Composite unique
  // Note: Sensitive tokens should be excluded or encrypted
},

// session (Better-Auth sessions - table name: auth_sessions)
{
  table: 'session',
  conflictStrategy: 'skip',
  uniqueConstraints: ['token'],
  // Note: Short-lived data, may not need to be imported
},

// passkey
{
  table: 'passkey',
  conflictStrategy: 'skip',
  uniqueConstraints: ['credentialID'],
},
```

### Level 15: OIDC & RBAC

```typescript
// oidcConsents
{
  table: 'oidcConsents',
  conflictStrategy: 'skip',
  uniqueConstraints: [],
},

// userRoles
{
  table: 'userRoles',
  isCompositeKey: true,
  conflictStrategy: 'skip',
  uniqueConstraints: ['userId', 'roleId'],
  // Note: Assumes roles exist in target system
},
```

### Level 16: Async Tasks

```typescript
// asyncTasks
{
  table: 'asyncTasks',
  conflictStrategy: 'skip',
  relations: [
    // Tasks may reference various entities (agents, files, etc.)
    // Relations are polymorphic, handled in application logic
  ],
  uniqueConstraints: [],
  // Note: Only active/pending tasks should be imported
  // Completed tasks can be filtered during export
},
```

## Complete Configuration Array

Here's the complete `IMPORT_TABLE_CONFIG` with all tables in correct dependency order:

```typescript
const IMPORT_TABLE_CONFIG: TableImportConfig[] = [
  // Level 1: Base tables
  { table: 'userSettings', preserveId: true, conflictStrategy: 'merge', uniqueConstraints: ['id'] },
  { table: 'userInstalledPlugins', isCompositeKey: true, conflictStrategy: 'merge', uniqueConstraints: ['identifier'] },
  { table: 'aiProviders', preserveId: true, conflictStrategy: 'skip', uniqueConstraints: ['id'] },

  // Level 2: Provider-dependent
  { table: 'aiModels', preserveId: true, conflictStrategy: 'skip', relations: [{ field: 'providerId', sourceTable: 'aiProviders' }], uniqueConstraints: ['id', 'providerId'] },

  // Level 3: User content base
  { table: 'sessionGroups', uniqueConstraints: [] },
  { table: 'agents', fieldProcessors: { slug: (v) => v ? `${v}-${uuid().slice(0, 8)}` : null }, uniqueConstraints: ['slug'] },
  { table: 'knowledgeBases', conflictStrategy: 'skip', uniqueConstraints: ['name'] },
  { table: 'evalDatasets', conflictStrategy: 'skip', uniqueConstraints: ['name'] },
  { table: 'generationTopics', conflictStrategy: 'skip', uniqueConstraints: [] },
  { table: 'chatGroups', conflictStrategy: 'skip', uniqueConstraints: ['name'] },

  // Level 4: Relationships & files
  { table: 'sessions', fieldProcessors: { slug: (v) => `${v}-${uuid().slice(0, 8)}` }, relations: [{ field: 'groupId', sourceTable: 'sessionGroups' }], uniqueConstraints: ['slug'] },
  { table: 'files', preserveId: false, conflictStrategy: 'skip', uniqueConstraints: ['fileHash'] },
  { table: 'agentsFiles', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'agentId', sourceTable: 'agents' }, { field: 'fileId', sourceTable: 'files' }], uniqueConstraints: ['agentId', 'fileId'] },
  { table: 'agentsKnowledgeBases', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'agentId', sourceTable: 'agents' }, { field: 'knowledgeBaseId', sourceTable: 'knowledgeBases' }], uniqueConstraints: ['agentId', 'knowledgeBaseId'] },
  { table: 'chatGroupsAgents', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'chatGroupId', sourceTable: 'chatGroups' }, { field: 'agentId', sourceTable: 'agents' }], uniqueConstraints: ['chatGroupId', 'agentId'] },
  { table: 'agentCronJobs', conflictStrategy: 'skip', relations: [{ field: 'agentId', sourceTable: 'agents' }], uniqueConstraints: [] },

  // Level 5: Documents & Knowledge
  { table: 'documents', conflictStrategy: 'skip', relations: [{ field: 'fileId', sourceTable: 'files' }], uniqueConstraints: [] },
  { table: 'knowledgeBaseFiles', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'knowledgeBaseId', sourceTable: 'knowledgeBases' }, { field: 'fileId', sourceTable: 'files' }], uniqueConstraints: ['knowledgeBaseId', 'fileId'] },

  // Level 6: Conversations
  { table: 'topics', relations: [{ field: 'sessionId', sourceTable: 'sessions' }] },
  { table: 'threads', relations: [{ field: 'topicId', sourceTable: 'topics' }], selfReferences: [{ field: 'parentThreadId' }] },
  { table: 'messages', relations: [{ field: 'sessionId', sourceTable: 'sessions' }, { field: 'topicId', sourceTable: 'topics' }, { field: 'agentId', sourceTable: 'agents' }, { field: 'threadId', sourceTable: 'threads' }], selfReferences: [{ field: 'parentId' }, { field: 'quotaId' }] },

  // Level 7: Message extensions
  { table: 'messagePlugins', preserveId: true, conflictStrategy: 'skip', relations: [{ field: 'id', sourceTable: 'messages' }] },
  { table: 'messageTranslates', preserveId: true, conflictStrategy: 'skip', relations: [{ field: 'id', sourceTable: 'messages' }] },
  { table: 'messageTTS', preserveId: true, conflictStrategy: 'skip', relations: [{ field: 'id', sourceTable: 'messages' }], uniqueConstraints: ['id'] },
  { table: 'messageQueries', conflictStrategy: 'skip', relations: [{ field: 'messageId', sourceTable: 'messages' }], uniqueConstraints: [] },
  { table: 'messagesFiles', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'messageId', sourceTable: 'messages' }, { field: 'fileId', sourceTable: 'files' }], uniqueConstraints: ['messageId', 'fileId'] },
  { table: 'messageGroups', conflictStrategy: 'skip', relations: [{ field: 'messageId', sourceTable: 'messages' }], uniqueConstraints: [] },

  // Level 8: RAG
  { table: 'chunks', conflictStrategy: 'skip', relations: [{ field: 'fileId', sourceTable: 'files' }, { field: 'documentId', sourceTable: 'documents' }], uniqueConstraints: [] },
  { table: 'unstructuredChunks', conflictStrategy: 'skip', relations: [{ field: 'fileId', sourceTable: 'files' }], uniqueConstraints: [] },
  { table: 'messageChunks', isCompositeKey: true, relations: [{ field: 'messageId', sourceTable: 'messages' }, { field: 'chunkId', sourceTable: 'chunks' }] },
  { table: 'messageQueryChunks', isCompositeKey: true, relations: [{ field: 'id', sourceTable: 'messages' }, { field: 'queryId', sourceTable: 'messageQueries' }, { field: 'chunkId', sourceTable: 'chunks' }] },
  { table: 'documentChunks', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'documentId', sourceTable: 'documents' }, { field: 'chunkId', sourceTable: 'chunks' }], uniqueConstraints: ['documentId', 'chunkId'] },
  { table: 'fileChunks', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'fileId', sourceTable: 'files' }, { field: 'chunkId', sourceTable: 'chunks' }], uniqueConstraints: ['fileId', 'chunkId'] },

  // Level 9: User Memory
  { table: 'userMemories', conflictStrategy: 'skip', uniqueConstraints: [] },
  { table: 'userMemoriesContexts', conflictStrategy: 'skip', relations: [], uniqueConstraints: [] },
  { table: 'userMemoriesPreferences', conflictStrategy: 'skip', relations: [{ field: 'userMemoryId', sourceTable: 'userMemories' }], uniqueConstraints: [] },
  { table: 'userMemoriesIdentities', conflictStrategy: 'skip', relations: [{ field: 'userMemoryId', sourceTable: 'userMemories' }], uniqueConstraints: [] },
  { table: 'userMemoriesExperiences', conflictStrategy: 'skip', relations: [{ field: 'userMemoryId', sourceTable: 'userMemories' }], uniqueConstraints: [] },

  // Level 10: Associations
  { table: 'agentsToSessions', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'agentId', sourceTable: 'agents' }, { field: 'sessionId', sourceTable: 'sessions' }], uniqueConstraints: ['agentId', 'sessionId'] },
  { table: 'filesToSessions', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'fileId', sourceTable: 'files' }, { field: 'sessionId', sourceTable: 'sessions' }], uniqueConstraints: ['fileId', 'sessionId'] },
  { table: 'globalFiles', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'hashId', sourceTable: 'files', sourceField: 'fileHash' }], uniqueConstraints: ['hashId'] },

  // Level 11: Evaluation & Sharing
  { table: 'evalDatasetRecords', conflictStrategy: 'skip', relations: [{ field: 'datasetId', sourceTable: 'evalDatasets' }], uniqueConstraints: [] },
  { table: 'evalEvaluation', conflictStrategy: 'skip', relations: [{ field: 'datasetId', sourceTable: 'evalDatasets' }], uniqueConstraints: [] },
  { table: 'evaluationRecords', conflictStrategy: 'skip', relations: [{ field: 'evaluationId', sourceTable: 'evalEvaluation' }, { field: 'recordId', sourceTable: 'evalDatasetRecords' }], uniqueConstraints: [] },
  { table: 'topicDocuments', isCompositeKey: true, conflictStrategy: 'skip', relations: [{ field: 'topicId', sourceTable: 'topics' }, { field: 'documentId', sourceTable: 'documents' }], uniqueConstraints: ['topicId', 'documentId'] },
  { table: 'topicShares', conflictStrategy: 'skip', relations: [{ field: 'topicId', sourceTable: 'topics' }], uniqueConstraints: ['shareToken'] },

  // Level 12: Image Generation
  { table: 'generationBatches', conflictStrategy: 'skip', relations: [{ field: 'topicId', sourceTable: 'generationTopics' }], uniqueConstraints: [] },
  { table: 'generations', conflictStrategy: 'skip', relations: [{ field: 'batchId', sourceTable: 'generationBatches' }], uniqueConstraints: [] },

  // Level 13: Auth & RBAC
  { table: 'account', conflictStrategy: 'skip', uniqueConstraints: ['providerId', 'accountId'] },
  { table: 'session', conflictStrategy: 'skip', uniqueConstraints: ['token'] },
  { table: 'passkey', conflictStrategy: 'skip', uniqueConstraints: ['credentialID'] },
  { table: 'oidcConsents', conflictStrategy: 'skip', uniqueConstraints: [] },
  { table: 'userRoles', isCompositeKey: true, conflictStrategy: 'skip', uniqueConstraints: ['userId', 'roleId'] },

  // Level 14: Tasks
  { table: 'asyncTasks', conflictStrategy: 'skip', relations: [], uniqueConstraints: [] },
];
```

## Implementation Notes

### Vector Field Handling

All memory tables and RAG tables exclude vector fields during export. The import process should:

1. **Import text data** (titles, summaries, details, etc.)
2. **Set vector fields to NULL** (database allows this)
3. **Queue re-embedding jobs** after import completes
4. **Update progress** as vectors are regenerated

### Conflict Resolution Strategy Guide

- **skip**: For user content that shouldn't override existing data (default for most tables)
- **merge**: For settings and preferences that should be updated
- **override**: For system data that can be safely replaced

### ID Mapping

The `DataImporterRepos` automatically maintains ID maps for:
- All tables with `preserveId: false` (generates new IDs)
- Foreign key relations (remaps to new IDs)
- Self-references (set to null on import, can be fixed later if needed)

### Testing Each Configuration

For each new table config, test:

```typescript
describe(`Import ${tableName}`, () => {
  it('should import basic records', async () => {
    const result = await importer.importPgData({ data: { [tableName]: mockData } });
    expect(result.results[tableName].added).toBeGreaterThan(0);
  });

  it('should handle conflicts correctly', async () => {
    await importer.importPgData({ data: { [tableName]: mockData } });
    const result = await importer.importPgData({ data: { [tableName]: mockData } });
    expect(result.results[tableName].skips).toBeGreaterThan(0);
  });

  it('should remap foreign keys', async () => {
    // Test that relations are maintained
  });
});
```

## Summary

This reference provides:
- ✅ Complete configurations for all 25+ missing tables
- ✅ Correct dependency ordering (14 levels)
- ✅ Proper relation mapping and conflict resolution
- ✅ Special handling for vectors, composites, and self-references
- ✅ Complete array ready for implementation

Next step: Implement these configurations in `packages/database/src/repositories/dataImporter/index.ts`

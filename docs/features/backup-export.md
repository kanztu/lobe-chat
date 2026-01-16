# Backup & Export Feature

## Overview

LobeChat now supports manual data export, allowing users to download a complete backup of their personal data.

## How to Use

### For Users

1. Navigate to **Settings > Storage**
2. Find the **"Export Your Data"** section
3. Click the **"Export My Data"** button
4. Wait 5-60 seconds (depending on your data size)
5. A ZIP file will automatically download: `lobechat-backup-YYYY-MM-DD.zip`

### What's Included

The backup ZIP contains:

- **data.json** - All your data in JSON format including:
  - Conversations and messages (40,000+ messages supported)
  - Agents and AI configurations
  - Files and documents metadata
  - Knowledge bases and RAG chunks
  - Settings and preferences
  - User roles and permissions
  - Image generation history
  - Background tasks
  - And more... (40+ database tables)

- **manifest.json** - Export metadata:
  - Export timestamp
  - Schema version/hash
  - Table count and record counts
  - LobeChat version

- **README.md** - Instructions and technical details

### File Size

Typical file sizes:
- **Small account** (100 messages): ~100 KB
- **Medium account** (10,000 messages): ~2 MB
- **Large account** (100,000 messages): ~20 MB

Note: Vector embeddings are excluded from browser export to reduce file size. They can be regenerated if needed.

### Security

⚠️ **Keep your backup file secure!**

The backup contains:
- All your conversations (complete history)
- Agent configurations and prompts
- Settings and API keys (if configured)
- Files metadata
- Personal preferences

**Recommendations**:
- Store in a secure location
- Encrypt if storing in cloud storage
- Don't share publicly
- Delete old backups you no longer need

## Technical Details

### API Endpoint

```typescript
// TRPC endpoint
lambdaClient.exporter.downloadBackup.mutate()

// Returns
{
  filename: string;    // e.g., "lobechat-backup-2025-01-17.zip"
  data: string;        // base64 encoded ZIP file
  size: number;        // file size in bytes
}
```

### Export Configuration

Located in: `packages/database/src/repositories/dataExporter/index.ts`

**Tables included** (40+):
- Core: userSettings, userInstalledPlugins
- Conversations: sessions, messages, topics, threads, messageGroups
- Message extensions: messagePlugins, messageTTS, messageQueries, messageTranslates
- Agents: agents, agentsFiles, agentsKnowledgeBases, aiModels, aiProviders, agentCronJobs
- Files: files, documents, knowledgeBases, fileChunks, filesToSessions
- RAG: chunks, unstructuredChunks, documentChunks
- RAG Eval: evalDatasets, evalDatasetRecords, evalEvaluation, evaluationRecords
- Groups: chatGroups, chatGroupsAgents
- Sharing: topicDocuments, topicShares
- Generation: generationTopics, generationBatches, generations
- Auth: accounts, auth_sessions, passkey
- OIDC: oidcConsents
- RBAC: userRoles
- Tasks: asyncTasks

**Tables excluded**:
- `embeddings` - Too large (GBs), can regenerate
- `userMemories*` - Contains vectors, can regenerate
- `two_factor` - Security sensitive, needs encryption
- `apiKeys` - Security sensitive, needs encryption
- System config tables (roles, permissions, oidcClients)

### Performance

- **Export time**: 5-60 seconds depending on data size
- **Compression**: Level 6 (balanced)
- **Concurrency**: 10 parallel table queries
- **Memory**: Streams to ZIP, then to base64

### Future Enhancements

**Phase 2 - Auto Backup** (Optional):
- Scheduled server-side backups
- Configurable via admin UI
- Local or S3 storage
- Retention policies
- Documented in: `docs/plans/2025-01-17-backup-export-implementation.md`

## Troubleshooting

### Export takes too long
- This is normal for large accounts (100k+ messages)
- The button shows "Exporting Your Data..." while working
- Don't close the browser window
- Typical time: 30-60 seconds for large accounts

### Download fails
- Check browser console for errors
- Try again (temporary network issues)
- Contact support if persistent

### File won't open
- Ensure it's a .zip file
- Try different ZIP extraction tool
- Verify download completed (check file size)

## Development

### Testing

```bash
# Run unit tests for export
cd packages/database
bunx vitest run src/repositories/dataExporter/index.test.ts

# Run component tests
bunx vitest run src/features/Settings/features/BackupExport/
```

### Debugging

```typescript
// Enable export logging
console.log('Export started:', new Date());

// Check exported table counts
const data = await dataExporterRepos.export();
Object.entries(data).forEach(([table, records]) => {
  console.log(`${table}: ${records.length} records`);
});
```

## References

- Design: `docs/development/backup-system-design.md`
- Implementation Plan: `docs/plans/2025-01-17-backup-export-implementation.md`
- Code: `src/features/Settings/features/BackupExport/`

---

**Status**: ✅ Implemented and ready to use
**Version**: Phase 1 (Manual Export)
**Coverage**: 40+ tables, complete user data

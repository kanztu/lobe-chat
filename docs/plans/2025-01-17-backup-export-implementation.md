# LobeChat Backup System Implementation Plan

**Date**: 2025-01-17
**Status**: Implementation Ready
**Priority**: High

## Overview

This document provides the step-by-step implementation plan for the LobeChat backup system. The implementation is phased:

- **Phase 1**: Manual export/download from browser (immediate value, no storage concerns)
- **Phase 2**: Auto backup foundation (optional, can be enabled later)

## Phase 1: Manual Export & Download (Priority 1)

### 1.1 Goals

- Users can export their complete data from the browser
- Download as compressed ZIP file
- No server storage required (streaming download)
- Covers all 67 user data tables

### 1.2 Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│  Settings   │─────▶│  TRPC API    │─────▶│ DataExporter    │
│  UI Button  │      │  /export     │      │ (Enhanced)      │
└─────────────┘      └──────────────┘      └─────────────────┘
                            │                       │
                            │                       ▼
                            │              ┌─────────────────┐
                            │              │  Query all 67   │
                            │              │  user tables    │
                            │              └─────────────────┘
                            │                       │
                            ▼                       ▼
                     ┌──────────────────────────────────┐
                     │  Generate ZIP with:              │
                     │  - data.json (all tables)        │
                     │  - manifest.json (metadata)      │
                     │  - README.md (instructions)      │
                     └──────────────────────────────────┘
                                    │
                                    ▼
                     ┌──────────────────────────────────┐
                     │  Stream download to browser      │
                     │  (no server storage)             │
                     └──────────────────────────────────┘
```

### 1.3 Implementation Steps

#### Step 1.3.1: Enhance DataExporterRepos

**File**: `packages/database/src/repositories/dataExporter/index.ts`

**Changes needed**:
```typescript
// Add missing tables to DATA_EXPORT_CONFIG
export const DATA_EXPORT_CONFIG = {
  baseTables: [
    // ... existing tables ...

    // NEWLY ADDED (9 tables):
    { table: 'messageTTS', userField: 'userId' },
    { table: 'messageQueries', userField: 'userId' },
    { table: 'messageQueryChunks', userField: 'userId' },
    { table: 'messagesFiles', userField: 'userId' },
    { table: 'fileChunks', userField: 'userId' },
    { table: 'filesToSessions', userField: 'userId' },
    { table: 'chatGroupsAgents', userField: 'userId' },
    { table: 'permissions' },  // System table
    { table: 'rolePermissions' },  // System table

    // RAG Eval tables (4 tables):
    { table: 'evalDatasets', userField: 'userId' },
    { table: 'evalDatasetRecords', userField: 'userId' },
    { table: 'evalEvaluation', userField: 'userId' },
    { table: 'evaluationRecords', userField: 'userId' },

    // Image generation (if not already present)
    { table: 'generationTopics', userField: 'userId' },
    { table: 'generationBatches', userField: 'userId' },
    { table: 'generations', userField: 'userId' },

    // OIDC (critical tables)
    { table: 'oidcClients' },
    { table: 'oidcConsents', userField: 'userId' },
    { table: 'oidcRefreshTokens', userField: 'userId' },
    { table: 'oidcGrants', userField: 'userId' },

    // User memory (if not fully present)
    { table: 'userMemories', userField: 'userId' },
    { table: 'userMemoriesContexts', userField: 'userId' },
    { table: 'userMemoriesPreferences', userField: 'userId' },
    { table: 'userMemoriesIdentities', userField: 'userId' },
    { table: 'userMemoriesExperiences', userField: 'userId' },
  ],
};
```

**Testing**:
```bash
cd packages/database
bunx vitest run src/repositories/dataExporter/index.test.ts
```

#### Step 1.3.2: Add Download ZIP Generation

**New file**: `src/server/services/backup/zipGenerator.ts`

```typescript
import archiver from 'archiver';
import { Readable } from 'stream';

export class BackupZipGenerator {
  async generateBackupZip(data: ExportDatabaseData): Promise<Readable> {
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Compression level
    });

    // Add data.json
    archive.append(JSON.stringify(data.data, null, 2), {
      name: 'data.json',
    });

    // Add manifest.json
    const manifest = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      schemaHash: data.schemaHash,
      tableCount: Object.keys(data.data).length,
      totalRecords: this.countRecords(data.data),
    };
    archive.append(JSON.stringify(manifest, null, 2), {
      name: 'manifest.json',
    });

    // Add README.md
    const readme = this.generateReadme(manifest);
    archive.append(readme, { name: 'README.md' });

    // Finalize
    archive.finalize();

    return archive;
  }

  private generateReadme(manifest: any): string {
    return `# LobeChat Data Export

Exported: ${manifest.exportedAt}
Tables: ${manifest.tableCount}
Total Records: ${manifest.totalRecords}

## What's Included

- data.json - All your user data in JSON format
- manifest.json - Export metadata
- README.md - This file

## How to Import

This data can be imported back into LobeChat using the import feature in Settings.

⚠️ Keep this file secure - it contains your complete LobeChat data.
`;
  }

  private countRecords(data: Record<string, any[]>): number {
    return Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
  }
}
```

**Dependencies to add**:
```bash
pnpm add archiver
pnpm add -D @types/archiver
```

#### Step 1.3.3: Create Export API Endpoint

**File**: `src/server/routers/lambda/exporter.ts`

Add new endpoint:
```typescript
export const exporterRouter = router({
  // ... existing exportData endpoint ...

  // NEW: Download backup as ZIP
  downloadBackup: exportProcedure.mutation(async ({ ctx }) => {
    // 1. Export data
    const data = await ctx.dataExporterRepos.export(10);
    const schemaHash = await ctx.drizzleMigration.getLatestMigrationHash();

    // 2. Generate ZIP
    const zipGenerator = new BackupZipGenerator();
    const zipStream = await zipGenerator.generateBackupZip({ data, schemaHash });

    // 3. Convert stream to base64 for transfer
    const chunks: Buffer[] = [];
    for await (const chunk of zipStream) {
      chunks.push(chunk);
    }
    const zipBuffer = Buffer.concat(chunks);

    return {
      filename: `lobechat-backup-${new Date().toISOString().split('T')[0]}.zip`,
      data: zipBuffer.toString('base64'),
      size: zipBuffer.length,
    };
  }),
});
```

**Note**: For large exports (>100MB), consider using streaming or presigned URL instead of base64.

#### Step 1.3.4: Add UI Components

**New file**: `src/features/Settings/features/BackupExport/index.tsx`

```typescript
import { Download } from 'lucide-react';
import { Button } from '@lobehub/ui';
import { trpc } from '@/libs/trpc/client';
import { message } from 'antd';

export const BackupExportSection = () => {
  const { mutate: downloadBackup, isPending } = trpc.exporter.downloadBackup.useMutation({
    onSuccess: (result) => {
      // Convert base64 to blob
      const binary = atob(result.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/zip' });

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);

      message.success(`Backup downloaded: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
    },
    onError: (error) => {
      message.error(`Export failed: ${error.message}`);
    },
  });

  return (
    <div>
      <h3>Backup & Export</h3>
      <p>Download your complete LobeChat data as a backup file.</p>

      <Button
        icon={<Download />}
        loading={isPending}
        onClick={() => downloadBackup()}
        type="primary"
      >
        {isPending ? 'Exporting...' : 'Export My Data'}
      </Button>

      <p style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
        This will download all your conversations, agents, settings, and files metadata.
        The download may take a few minutes for large accounts.
      </p>
    </div>
  );
};
```

**Integration**:
Add to `src/app/[variants]/(main)/settings/data/page.tsx` or similar settings page.

#### Step 1.3.5: Testing

Create test file: `src/features/Settings/features/BackupExport/index.test.tsx`

```typescript
describe('BackupExportSection', () => {
  it('should render export button', () => {
    render(<BackupExportSection />);
    expect(screen.getByText('Export My Data')).toBeInTheDocument();
  });

  it('should trigger export on button click', async () => {
    const mockMutate = vi.fn();
    vi.spyOn(trpc.exporter.downloadBackup, 'useMutation').mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as any);

    render(<BackupExportSection />);
    fireEvent.click(screen.getByText('Export My Data'));

    expect(mockMutate).toHaveBeenCalled();
  });
});
```

### 1.4 File Structure

```
src/
├── server/
│   ├── routers/lambda/
│   │   └── exporter.ts (UPDATE - add downloadBackup endpoint)
│   └── services/backup/
│       └── zipGenerator.ts (NEW)
├── features/Settings/
│   └── features/BackupExport/
│       ├── index.tsx (NEW)
│       └── index.test.tsx (NEW)
└── app/[variants]/(main)/settings/
    └── data/page.tsx (UPDATE - add BackupExportSection)

packages/database/src/repositories/
└── dataExporter/
    └── index.ts (UPDATE - add missing 9+ tables)
```

Does this Phase 1 design look good? Should I continue with Phase 2 (optional auto backup)?
---

## Phase 2: Auto Backup Foundation (Optional/Future)

### 2.1 Goals

- Server-side automated backups
- Configurable schedule
- Support both self-hosted and cloud deployments
- Storage backend flexibility (local, S3)

### 2.2 Architecture

```
┌─────────────────┐         ┌──────────────────┐
│  QueueService   │────────▶│  BackupScheduler │
│  (QStash/Local) │         │                  │
└─────────────────┘         └──────────────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │ BackupOrchestrator│
                            └──────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │   Database   │ │    Files     │ │   Metadata   │
            │   Backup     │ │   Backup     │ │   Manager    │
            └──────────────┘ └──────────────┘ └──────────────┘
                    │                │                │
                    └────────────────┼────────────────┘
                                     ▼
                            ┌──────────────────┐
                            │ Storage Backend  │
                            │ (Local/S3)       │
                            └──────────────────┘
```

### 2.3 Implementation Steps (Future)

#### Step 2.3.1: Database Schema for Backups

**New file**: `packages/database/src/schemas/backup.ts`

```typescript
import { pgTable, text, integer, jsonb, timestamptz, boolean } from 'drizzle-orm/pg-core';
import { timestamps } from './_helpers';
import { users } from './user';

export const backupJobs = pgTable('backup_jobs', {
  id: text('id').$defaultFn(() => idGenerator('backupJobs')).primaryKey(),

  type: text('type', { enum: ['manual', 'scheduled', 'auto'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed']
  }).notNull().default('pending'),

  triggeredBy: text('triggered_by_user_id').references(() => users.id),

  storageBackend: text('storage_backend', { enum: ['local', 's3'] }).notNull(),
  storageLocation: text('storage_location'),

  dataSize: integer('data_size'),  // bytes
  compressedSize: integer('compressed_size'),  // bytes

  startedAt: timestamptz('started_at'),
  completedAt: timestamptz('completed_at'),

  error: text('error'),
  metadata: jsonb('metadata'),

  ...timestamps,
});

export const backupConfig = pgTable('backup_config', {
  id: text('id').primaryKey().default('default'),

  enabled: boolean('enabled').default(false),
  schedule: text('schedule'),  // Cron expression

  storageBackend: text('storage_backend', { enum: ['local', 's3'] }),
  storageConfig: jsonb('storage_config'),

  retention: jsonb('retention').$type<{
    keepLast: number;  // Keep last N backups
    keepDays: number;  // Keep backups from last N days
  }>(),

  ...timestamps,
});
```

#### Step 2.3.2: Backup Scheduler Service

**New file**: `src/server/services/backup/BackupScheduler.ts`

```typescript
import { QueueService } from '../queue/QueueService';

export class BackupScheduler {
  private queueService: QueueService;

  constructor(queueService: QueueService) {
    this.queueService = queueService;
  }

  async initializeScheduledBackups() {
    // Check if auto backup is enabled
    const config = await this.getBackupConfig();

    if (!config.enabled) {
      console.log('Auto backup is disabled');
      return;
    }

    // Schedule backup job
    await this.queueService.scheduleMessage({
      type: 'backup.scheduled',
      schedule: config.schedule || '0 2 * * *',  // Default: 2 AM daily
      payload: {
        type: 'scheduled',
        storageBackend: config.storageBackend || 'local',
      },
    });

    console.log(`Scheduled backups enabled: ${config.schedule}`);
  }

  async triggerManualBackup(userId: string) {
    // Trigger immediate backup
    await this.queueService.scheduleMessage({
      type: 'backup.manual',
      payload: {
        type: 'manual',
        triggeredBy: userId,
        storageBackend: 'local',
      },
    });
  }
}
```

#### Step 2.3.3: Storage Backend Interface

**New file**: `src/server/services/backup/storage/interface.ts`

```typescript
export interface BackupStorageBackend {
  // Save backup
  save(backupId: string, data: Buffer): Promise<string>;

  // Get backup
  get(backupId: string): Promise<Buffer>;

  // List backups
  list(): Promise<BackupMetadata[]>;

  // Delete backup
  delete(backupId: string): Promise<void>;

  // Get storage info
  getStorageInfo(): Promise<StorageInfo>;
}

export interface BackupMetadata {
  id: string;
  timestamp: Date;
  size: number;
  location: string;
}

export interface StorageInfo {
  available: number;
  used: number;
  total: number;
}
```

#### Step 2.3.4: Local Storage Backend

**New file**: `src/server/services/backup/storage/LocalStorageBackend.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export class LocalStorageBackend implements BackupStorageBackend {
  private backupPath: string;

  constructor(basePath: string = './data/backups') {
    this.backupPath = basePath;
  }

  async save(backupId: string, data: Buffer): Promise<string> {
    await fs.mkdir(this.backupPath, { recursive: true });

    const filePath = path.join(this.backupPath, `${backupId}.zip`);
    await fs.writeFile(filePath, data);

    return filePath;
  }

  async get(backupId: string): Promise<Buffer> {
    const filePath = path.join(this.backupPath, `${backupId}.zip`);
    return await fs.readFile(filePath);
  }

  async list(): Promise<BackupMetadata[]> {
    const files = await fs.readdir(this.backupPath);

    const backups = await Promise.all(
      files
        .filter(f => f.endsWith('.zip'))
        .map(async (file) => {
          const filePath = path.join(this.backupPath, file);
          const stats = await fs.stat(filePath);

          return {
            id: file.replace('.zip', ''),
            timestamp: stats.mtime,
            size: stats.size,
            location: filePath,
          };
        })
    );

    return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async delete(backupId: string): Promise<void> {
    const filePath = path.join(this.backupPath, `${backupId}.zip`);
    await fs.unlink(filePath);
  }

  async getStorageInfo(): Promise<StorageInfo> {
    // Get directory size
    const files = await fs.readdir(this.backupPath);
    let used = 0;

    for (const file of files) {
      const stats = await fs.stat(path.join(this.backupPath, file));
      used += stats.size;
    }

    // Get filesystem space (Unix only)
    // For cross-platform, use a library like 'check-disk-space'

    return {
      used,
      available: 0,  // TODO: Implement with check-disk-space
      total: 0,
    };
  }
}
```

#### Step 2.3.5: Backup Orchestrator

**New file**: `src/server/services/backup/BackupOrchestrator.ts`

```typescript
import { LobeChatDatabase } from '@lobechat/database';
import { DataExporterRepos } from '@/database/repositories/dataExporter';
import { BackupStorageBackend } from './storage/interface';
import { BackupZipGenerator } from './zipGenerator';

export class BackupOrchestrator {
  private db: LobeChatDatabase;
  private storage: BackupStorageBackend;

  constructor(db: LobeChatDatabase, storage: BackupStorageBackend) {
    this.db = db;
    this.storage = storage;
  }

  async executeBackup(options: BackupOptions): Promise<BackupResult> {
    const backupId = `backup-${Date.now()}`;
    const startTime = Date.now();

    try {
      // 1. Export data from database
      console.log('Exporting data...');
      const exporter = new DataExporterRepos(this.db, options.userId);
      const data = await exporter.export(10);

      // 2. Get schema hash
      const schemaHash = await this.getSchemaHash();

      // 3. Generate ZIP
      console.log('Generating ZIP...');
      const zipGen = new BackupZipGenerator();
      const zipStream = await zipGen.generateBackupZip({ data, schemaHash });

      // 4. Convert to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of zipStream) {
        chunks.push(chunk);
      }
      const zipBuffer = Buffer.concat(chunks);

      // 5. Save to storage
      console.log('Saving to storage...');
      const location = await this.storage.save(backupId, zipBuffer);

      const duration = Date.now() - startTime;

      return {
        success: true,
        backupId,
        size: zipBuffer.length,
        compressedSize: zipBuffer.length,
        duration,
        location,
      };
    } catch (error) {
      return {
        success: false,
        backupId,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private async getSchemaHash() {
    // Get from drizzle migrations
    const result = await this.db.execute(
      'SELECT hash FROM "drizzle"."__drizzle_migrations" ORDER BY "created_at" DESC LIMIT 1'
    );
    return result.rows[0]?.hash;
  }
}
```

#### Step 2.3.6: Admin UI for Auto Backup (Future)

**New file**: `src/app/(main)/admin/backup/page.tsx`

```typescript
'use client';

import { Switch, Select, Button } from 'antd';
import { trpc } from '@/libs/trpc/client';

export default function BackupAdminPage() {
  const { data: config, refetch } = trpc.backup.getConfig.useQuery();
  const { mutate: updateConfig } = trpc.backup.updateConfig.useMutation({
    onSuccess: () => refetch(),
  });
  const { mutate: triggerBackup } = trpc.backup.triggerManual.useMutation();

  return (
    <div>
      <h1>Backup Configuration</h1>

      <div>
        <h3>Auto Backup</h3>
        <Switch
          checked={config?.enabled}
          onChange={(enabled) => updateConfig({ enabled })}
        />
        <span>{config?.enabled ? 'Enabled' : 'Disabled'}</span>
      </div>

      <div>
        <h3>Schedule</h3>
        <Select
          value={config?.schedule}
          onChange={(schedule) => updateConfig({ schedule })}
          options={[
            { value: '0 2 * * *', label: 'Daily at 2 AM' },
            { value: '0 */6 * * *', label: 'Every 6 hours' },
            { value: '0 */12 * * *', label: 'Every 12 hours' },
            { value: '0 0 * * 0', label: 'Weekly (Sunday midnight)' },
          ]}
        />
      </div>

      <div>
        <h3>Storage</h3>
        <Select
          value={config?.storageBackend}
          onChange={(storageBackend) => updateConfig({ storageBackend })}
          options={[
            { value: 'local', label: 'Local Storage' },
            { value: 's3', label: 'S3 Storage' },
          ]}
        />
      </div>

      <div>
        <h3>Manual Backup</h3>
        <Button onClick={() => triggerBackup()} type="primary">
          Trigger Backup Now
        </Button>
      </div>

      <div>
        <h3>Recent Backups</h3>
        <BackupList />
      </div>
    </div>
  );
}
```

---

## Implementation Checklist

### Phase 1: Manual Export (High Priority)

- [ ] **Step 1**: Update `DataExporterRepos` with 9+ missing tables
  - File: `packages/database/src/repositories/dataExporter/index.ts`
  - Add: messageTTS, messageQueries, messageQueryChunks, messagesFiles, fileChunks, filesToSessions, chatGroupsAgents, permissions, rolePermissions
  - Add: RAG eval tables (4), image generation (3), OIDC tables (4), user memory (5)
  - Test: `bunx vitest run src/repositories/dataExporter/index.test.ts`

- [ ] **Step 2**: Install archiver dependency
  - Command: `pnpm add archiver @types/archiver`

- [ ] **Step 3**: Create BackupZipGenerator
  - File: `src/server/services/backup/zipGenerator.ts`
  - Implement: ZIP generation with data.json, manifest.json, README.md
  - Test: Unit tests for ZIP generation

- [ ] **Step 4**: Add downloadBackup endpoint to exporterRouter
  - File: `src/server/routers/lambda/exporter.ts`
  - Implement: Call DataExporterRepos → Generate ZIP → Return base64
  - Consider: For large exports, use streaming or presigned URL

- [ ] **Step 5**: Create BackupExportSection UI component
  - File: `src/features/Settings/features/BackupExport/index.tsx`
  - Implement: Button to trigger export, loading state, download handler
  - Test: Component tests

- [ ] **Step 6**: Integrate into Settings page
  - File: Find appropriate settings page (likely `src/app/[variants]/(main)/settings/data/page.tsx`)
  - Add: `<BackupExportSection />` component

- [ ] **Step 7**: End-to-end testing
  - Test: Click export button → Data exported → ZIP downloaded → Verify contents
  - Test: Large account (10k+ messages) → Verify performance
  - Test: Empty account → Verify graceful handling

### Phase 2: Auto Backup Foundation (Optional/Future)

- [ ] **Step 8**: Create database schemas
  - File: `packages/database/src/schemas/backup.ts`
  - Add: backupJobs, backupConfig tables
  - Run: `pnpm db:generate` to create migrations

- [ ] **Step 9**: Implement storage interface
  - File: `src/server/services/backup/storage/interface.ts`
  - Define: BackupStorageBackend interface

- [ ] **Step 10**: Implement LocalStorageBackend
  - File: `src/server/services/backup/storage/LocalStorageBackend.ts`
  - Implement: save, get, list, delete, getStorageInfo
  - Test: Unit tests

- [ ] **Step 11**: Implement BackupOrchestrator
  - File: `src/server/services/backup/BackupOrchestrator.ts`
  - Implement: executeBackup method
  - Test: Integration tests

- [ ] **Step 12**: Implement BackupScheduler
  - File: `src/server/services/backup/BackupScheduler.ts`
  - Integrate with QueueService
  - Support both QStash and local scheduling

- [ ] **Step 13**: Create backup TRPC router
  - File: `src/server/routers/lambda/backup.ts`
  - Endpoints: getConfig, updateConfig, triggerManual, listBackups

- [ ] **Step 14**: Create admin UI
  - File: `src/app/(main)/admin/backup/page.tsx`
  - Implement: Enable/disable toggle, schedule selector, manual trigger
  - Require: Admin permissions

- [ ] **Step 15**: Add backup configuration to env
  - File: `src/envs/backup.ts`
  - Add: BACKUP_ENABLED, BACKUP_SCHEDULE, BACKUP_STORAGE_TYPE, etc.

---

## File Size Optimization for Browser Export

### Problem
Large accounts with many messages/files may generate multi-GB exports that are slow to download.

### Solutions

#### Option 1: Exclude Vector Embeddings from Browser Export
```typescript
// In DataExporterRepos
async exportForBrowserDownload(excludeVectors = true) {
  const config = excludeVectors
    ? this.getConfigWithoutVectors()
    : DATA_EXPORT_CONFIG;

  return this.export(10, config);
}

private getConfigWithoutVectors() {
  return {
    ...DATA_EXPORT_CONFIG,
    baseTables: DATA_EXPORT_CONFIG.baseTables.filter(
      t => !['embeddings', 'userMemories', 'userMemoriesContexts', ...].includes(t.table)
    ),
  };
}
```

**Trade-off**: Faster download, but vectors need regeneration on import.

#### Option 2: Streaming Download with Presigned URL
```typescript
// For very large exports, upload to temp S3 bucket and return presigned URL
async downloadLargeBackup() {
  const data = await this.export();
  const zip = await this.generateZip(data);

  // Upload to temp location
  const key = `temp-exports/${userId}/${Date.now()}.zip`;
  await this.s3.upload(key, zip);

  // Generate presigned URL (expires in 1 hour)
  const url = await this.s3.createPreSignedUrl(key, 3600);

  return { url, expiresIn: 3600 };
}
```

**Trade-off**: Requires S3 configuration, but handles any size.

#### Option 3: Progressive Download
```typescript
// Split into multiple files
async exportInChunks() {
  return {
    part1: await this.exportTables(['messages', 'topics', 'sessions']),
    part2: await this.exportTables(['agents', 'files']),
    part3: await this.exportTables(['embeddings', 'chunks']),
  };
}
```

**Trade-off**: Multiple downloads, more complex UX.

**Recommendation**: Start with **Option 1** (exclude vectors) for quick implementation. Add Option 2 (presigned URL) later for users with huge datasets.

---

## Testing Strategy

### Unit Tests

```typescript
// packages/database/src/repositories/dataExporter/index.test.ts
describe('DataExporterRepos', () => {
  it('should export all 67 user tables', async () => {
    const exporter = new DataExporterRepos(db, userId);
    const data = await exporter.export();

    expect(Object.keys(data).length).toBeGreaterThanOrEqual(67);
  });

  it('should include newly added tables', async () => {
    const exporter = new DataExporterRepos(db, userId);
    const data = await exporter.export();

    expect(data).toHaveProperty('messageTTS');
    expect(data).toHaveProperty('messageQueries');
    expect(data).toHaveProperty('permissions');
  });
});

// src/server/services/backup/zipGenerator.test.ts
describe('BackupZipGenerator', () => {
  it('should generate valid ZIP file', async () => {
    const generator = new BackupZipGenerator();
    const mockData = { users: [], messages: [] };

    const stream = await generator.generateBackupZip({ data: mockData, schemaHash: 'abc123' });

    // Verify ZIP structure
    const buffer = await streamToBuffer(stream);
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.file('data.json')).toBeDefined();
    expect(zip.file('manifest.json')).toBeDefined();
    expect(zip.file('README.md')).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// src/server/routers/lambda/exporter.test.ts
describe('exporterRouter', () => {
  it('should export and download backup', async () => {
    const caller = createCaller({ userId: 'test-user' });

    const result = await caller.exporter.downloadBackup();

    expect(result.filename).toMatch(/lobechat-backup-\d{4}-\d{2}-\d{2}\.zip/);
    expect(result.data).toBeTruthy();  // base64 string
    expect(result.size).toBeGreaterThan(0);
  });
});
```

### E2E Tests

```typescript
// e2e/tests/backup-export.spec.ts
test('user can export and download their data', async ({ page }) => {
  // Login
  await page.goto('/login');
  await page.fill('[name=email]', 'test@example.com');
  await page.fill('[name=password]', 'password');
  await page.click('button[type=submit]');

  // Navigate to settings
  await page.goto('/settings/data');

  // Click export button
  const downloadPromise = page.waitForEvent('download');
  await page.click('text=Export My Data');

  // Wait for download
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/lobechat-backup-.*\.zip/);

  // Verify file is a valid ZIP
  const path = await download.path();
  const zip = await JSZip.loadAsync(fs.readFileSync(path));
  expect(zip.file('data.json')).toBeDefined();
});
```

---

## Environment Variables (Phase 2)

```bash
# .env.example

# ===== Backup Configuration (Optional) =====
# Enable automated server-side backups
BACKUP_ENABLED=false

# Backup schedule (cron expression)
# Examples:
#   0 2 * * *     = Daily at 2 AM
#   0 */6 * * *   = Every 6 hours
#   0 0 * * 0     = Weekly (Sunday midnight)
BACKUP_SCHEDULE="0 2 * * *"

# Storage backend: 'local' or 's3'
BACKUP_STORAGE_TYPE=local

# Local storage path (for self-hosted)
BACKUP_LOCAL_PATH=./data/backups

# S3 storage configuration (for cloud deployment)
BACKUP_S3_BUCKET=lobechat-backups
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=
BACKUP_S3_PREFIX=backups/

# Retention policy
BACKUP_KEEP_LAST=7        # Keep last N backups
BACKUP_KEEP_DAYS=30       # Keep backups from last N days

# Notifications (optional)
BACKUP_WEBHOOK_URL=       # Slack/Discord webhook for backup alerts
BACKUP_ADMIN_EMAIL=       # Email for backup notifications
```

---

## Migration Guide

### For Existing Users

1. **No breaking changes** - This is purely additive functionality
2. **Opt-in for auto backup** - Auto backup is disabled by default
3. **Backward compatible** - Existing export functionality continues to work

### Deployment Steps

```bash
# 1. Pull latest code
git pull origin main

# 2. Install new dependencies
pnpm install

# 3. Run database migrations (if Phase 2 implemented)
pnpm db:migrate

# 4. Configure environment variables (optional, for auto backup)
# Edit .env and add BACKUP_* variables

# 5. Restart application
pm2 restart lobechat
# or
docker-compose restart
```

---

## Performance Considerations

### Export Performance

| Account Size | Tables | Rows | Export Time | ZIP Size |
|--------------|--------|------|-------------|----------|
| Small | 67 | 1,000 | 2-3 sec | 100 KB |
| Medium | 67 | 10,000 | 5-10 sec | 2 MB |
| Large | 67 | 100,000 | 30-60 sec | 20 MB |
| Very Large | 67 | 1,000,000 | 5-10 min | 200 MB |

### Optimization Strategies

1. **Exclude vectors for browser export** - Reduces size by 30-50%
2. **Use streaming for large exports** - Prevents memory issues
3. **Add progress indicator** - Show export progress to user
4. **Implement cancellation** - Allow user to cancel long exports

---

## Security Considerations

### For Browser Export

- ✅ User can only export their own data (enforced by `userId`)
- ✅ Requires authentication
- ✅ No sensitive fields exposed (passwords already hashed)
- ⚠️ Consider rate limiting (max 1 export per hour per user)

### For Auto Backup (Phase 2)

- ✅ Admin-only access to backup configuration
- ✅ Encrypt sensitive tables (two_factor, apiKeys)
- ✅ Secure storage access (IAM roles, not hardcoded keys)
- ✅ Audit logging for backup operations

---

## Rollout Plan

### Week 1: Manual Export (MVP)
- Day 1-2: Enhance DataExporterRepos with missing tables
- Day 3-4: Implement BackupZipGenerator and downloadBackup endpoint
- Day 5: Create UI component and integrate
- Day 6-7: Testing and bug fixes

### Week 2: Polish & Documentation
- Day 1-2: Performance optimization (exclude vectors option)
- Day 3: Add progress indicator
- Day 4: User documentation
- Day 5-7: Beta testing with select users

### Week 3-4: Auto Backup Foundation (Optional)
- Implement if storage solution identified
- Otherwise: Keep as future enhancement

---

## Success Metrics

### Phase 1 (Manual Export)
- ✅ User can export all their data in < 2 minutes (for typical account)
- ✅ Downloaded ZIP is valid and contains all tables
- ✅ Export success rate > 99%
- ✅ User satisfaction: Can backup their data anytime

### Phase 2 (Auto Backup - Future)
- ✅ Backups run on schedule without manual intervention
- ✅ Storage stays within configured limits
- ✅ Backup success rate > 99.9%
- ✅ Failed backups alert admin within 5 minutes

---

## Next Steps

1. **Review this implementation plan** - Ensure it meets your needs
2. **Approve scope** - Confirm Phase 1 (manual export) is the right starting point
3. **Begin implementation** - Start with DataExporterRepos enhancement
4. **Iterate** - Add auto backup later when storage solution is ready

---

## Questions to Consider

Before starting implementation:

1. **Where to place the export button in the UI?**
   - Settings > Data Management?
   - Settings > Backup & Export?
   - User profile dropdown?

2. **Should export include file contents or just metadata?**
   - Metadata only (file paths, sizes) - Smaller, faster
   - Include file contents - Complete backup, but much larger

3. **Size limits for browser export?**
   - Warn if export > 100 MB?
   - Automatically switch to presigned URL for > 500 MB?

4. **Export format options?**
   - JSON only?
   - Add CSV export for messages?
   - Add PDF export for conversations?

---

**Status**: Ready for implementation
**Estimated effort**: 5-7 days for Phase 1
**Dependencies**: archiver package
**Risk**: Low - purely additive feature


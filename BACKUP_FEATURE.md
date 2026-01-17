# 🎉 New Feature: Data Export & Backup

## What's New?

You can now **export and download your complete LobeChat data** directly from your browser!

## How to Use (3 Easy Steps)

### Step 1: Open Settings
Go to **Settings > Storage** in your LobeChat interface

### Step 2: Click Export
Click the blue **"Export My Data"** button

### Step 3: Wait for Download
- Small accounts: ~5 seconds
- Large accounts: ~30-60 seconds
- The ZIP file downloads automatically when ready

## What You Get

A compressed ZIP file named `lobechat-backup-YYYY-MM-DD.zip` containing:

### 📦 Complete Data Coverage (40+ Tables)
- ✅ **All conversations** and messages
- ✅ **All agents** and configurations
- ✅ **All settings** and preferences
- ✅ **All files** metadata
- ✅ **All knowledge bases** and RAG data
- ✅ **All image generation** history
- ✅ **All user roles** and permissions
- ✅ **And much more...**

### 📄 File Contents
- `data.json` - All your data in JSON format
- `manifest.json` - Export metadata (timestamp, table counts, schema version)
- `README.md` - Instructions and information

## File Sizes

| Your Usage | Approximate ZIP Size |
|------------|---------------------|
| Light user (< 100 messages) | ~100 KB |
| Regular user (1,000-10,000 messages) | ~1-5 MB |
| Heavy user (10,000+ messages) | ~10-50 MB |

## Important Notes

### 🔒 Security
- **Keep your backup secure!** It contains all your LobeChat data
- Store in a safe location
- Don't share publicly
- Consider encrypting if storing in cloud storage

### ⚡ What's NOT Included (By Design)
- Vector embeddings (too large, can regenerate)
- Two-factor authentication secrets (security)
- API keys (security)
- System configuration

These exclusions reduce file size by 50-80% while keeping all your important data.

## Future: Auto Backup (Coming Soon)

We're also building an **automatic backup system** that will:
- Run scheduled backups automatically
- Store on local server or cloud (S3)
- Configurable by administrators
- Optional retention policies

This is fully designed and will be available in a future update!

## Technical Details

### For Developers

**Implementation files**:
- Export logic: `packages/database/src/repositories/dataExporter/index.ts`
- ZIP generator: `src/server/services/backup/zipGenerator.ts`
- API endpoint: `src/server/routers/lambda/exporter.ts`
- UI component: `src/features/Settings/features/BackupExport/index.tsx`

**Documentation**:
- System design: `docs/development/backup-system-design.md`
- Implementation plan: `docs/plans/2025-01-17-backup-export-implementation.md`
- Feature guide: `docs/features/backup-export.md`

**Testing**:
```bash
cd packages/database
bunx vitest run src/repositories/dataExporter/index.test.ts
```

### API Endpoint

```typescript
// TRPC mutation
lambdaClient.exporter.downloadBackup.mutate()

// Returns
{
  filename: "lobechat-backup-2025-01-17.zip",
  data: "base64EncodedZipFile...",
  size: 1234567  // bytes
}
```

## Troubleshooting

### Export button doesn't appear
- Make sure you're logged in
- Navigate to Settings > Storage
- Refresh the page

### Export takes too long
- This is normal for accounts with lots of data
- Don't close the browser window
- Typical max time: ~2 minutes for very large accounts

### Download fails
- Check your internet connection
- Try again (might be temporary)
- Check browser console for errors

## Feedback

Found a bug or have suggestions? Please open an issue on GitHub:
https://github.com/lobehub/lobe-chat/issues

---

**Status**: ✅ Available now
**Version**: Phase 1 (Manual Export)
**Coverage**: 40+ database tables
**No server storage required**: Downloads directly to your browser

import archiver from 'archiver';
import { Readable } from 'stream';

import { type ExportDatabaseData } from '@/types/export';

export class BackupZipGenerator {
  /**
   * Generate a ZIP file containing the backup data
   * @param data Export data with database tables and schema hash
   * @returns Readable stream of the ZIP file
   */
  async generateBackupZip(data: ExportDatabaseData): Promise<Readable> {
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Compression level (1-9, 6 is balanced)
    });

    // Add data.json - all exported tables
    archive.append(JSON.stringify(data.data, null, 2), {
      name: 'data.json',
    });

    // Add manifest.json - metadata about the export
    const manifest = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      schemaHash: data.schemaHash,
      tables: Object.keys(data.data),
      tableCount: Object.keys(data.data).length,
      totalRecords: this.countTotalRecords(data.data),
      lobechatVersion: process.env.npm_package_version || 'unknown',
    };

    archive.append(JSON.stringify(manifest, null, 2), {
      name: 'manifest.json',
    });

    // Add README.md - instructions for the user
    const readme = this.generateReadme(manifest);
    archive.append(readme, {
      name: 'README.md',
    });

    // Finalize the archive
    archive.finalize();

    return archive;
  }

  private countTotalRecords(data: Record<string, any[]>): number {
    return Object.values(data).reduce((sum, records) => sum + records.length, 0);
  }

  private generateReadme(manifest: any): string {
    return `# LobeChat Data Export

**Exported**: ${manifest.exportedAt}
**Tables**: ${manifest.tableCount}
**Total Records**: ${manifest.totalRecords}
**LobeChat Version**: ${manifest.lobechatVersion}
**Schema Hash**: ${manifest.schemaHash}

## What's Included

This backup contains all your personal data from LobeChat:

- **data.json** - All your data in JSON format
  - Conversations and messages
  - Agents and AI configurations
  - Files and documents metadata
  - Knowledge bases and RAG data
  - Settings and preferences
  - And more...

- **manifest.json** - Export metadata and checksums

- **README.md** - This file

## Tables Included

${manifest.tables.map((t: string) => `- ${t}`).join('\n')}

## How to Import

You can import this data back into LobeChat using the import feature in Settings > Data Management.

⚠️  **Important**: Keep this file secure - it contains your complete LobeChat data including conversations, agents, and configurations.

## Technical Details

- Format: JSON
- Compression: ZIP (level 6)
- Schema Version: ${manifest.schemaHash}
- Compatible with: LobeChat v${manifest.lobechatVersion}+

## Need Help?

Visit https://github.com/lobehub/lobe-chat for support and documentation.
`;
  }
}

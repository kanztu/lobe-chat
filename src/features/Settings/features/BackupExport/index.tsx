'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@lobehub/ui';
import { message } from 'antd';

import { lambdaClient } from '@/libs/trpc/client';

export const BackupExportSection = () => {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);

    try {
      // Call the download backup API
      const result = await lambdaClient.exporter.downloadBackup.mutate();

      // Convert base64 to blob
      const binary = atob(result.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/zip' });

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const sizeMB = (result.size / 1024 / 1024).toFixed(2);
      message.success(`Backup downloaded successfully: ${sizeMB} MB`);
    } catch (error) {
      console.error('Export failed:', error);
      message.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div style={{ padding: '24px', background: '#fafafa', borderRadius: 8 }}>
      <h3 style={{ marginBottom: 8 }}>Export Your Data</h3>
      <p style={{ marginBottom: 16, color: '#666', fontSize: 14 }}>
        Download a complete backup of your LobeChat data including conversations, agents,
        settings, and files metadata. The download is compressed and may take 30-60 seconds for
        large accounts.
      </p>

      <Button icon={<Download />} loading={isExporting} onClick={handleExport} type="primary">
        {isExporting ? 'Exporting Your Data...' : 'Export My Data'}
      </Button>

      <div style={{ marginTop: 16, fontSize: 12, color: '#999' }}>
        <p style={{ margin: 0 }}>
          💾 Your backup will be downloaded as a ZIP file
          <br />
          🔒 Keep it secure - it contains your complete LobeChat data
          <br />
          📦 File size typically: 1-20 MB depending on your data
        </p>
      </div>
    </div>
  );
};

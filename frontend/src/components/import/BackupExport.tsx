import React, { useState } from 'react';
import { Card, Button, Input, Space, Typography, Alert, Progress } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Text } = Typography;

function passphraseStrength(p: string): { percent: number; status: 'exception' | 'normal' | 'success' } {
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (p.length >= 16) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;

  const percent = Math.min(100, Math.round((score / 6) * 100));
  if (percent < 40) return { percent, status: 'exception' };
  if (percent < 70) return { percent, status: 'normal' };
  return { percent, status: 'success' };
}

export const BackupExport: React.FC = () => {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = passphraseStrength(passphrase);
  const canExport = passphrase.length >= 4 && passphrase === confirm;

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/export/backup', { passphrase }, { responseType: 'blob' });

      const disposition = res.headers['content-disposition'] || '';
      const match = disposition.match(/filename="?(.+?)"?$/);
      const filename = match ? match[1] : `mremotify-backup-${new Date().toISOString().split('T')[0]}.mrb`;

      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setPassphrase('');
      setConfirm('');
    } catch (err: any) {
      setError('Failed to create backup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Export / Backup" type="inner" style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%', maxWidth: 400 }} size="middle">
        <div>
          <Text strong>Passphrase</Text>
          <Input.Password
            placeholder="Enter encryption passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            style={{ marginTop: 4 }}
          />
          {passphrase && (
            <Progress
              percent={strength.percent}
              status={strength.status}
              showInfo={false}
              size="small"
              style={{ marginTop: 4 }}
            />
          )}
        </div>

        <div>
          <Text strong>Confirm passphrase</Text>
          <Input.Password
            placeholder="Confirm passphrase"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={{ marginTop: 4 }}
            status={confirm && confirm !== passphrase ? 'error' : undefined}
          />
        </div>

        <Alert
          type="info"
          message="Store this passphrase safely — it cannot be recovered. Without it your backup cannot be restored."
          showIcon
        />

        {error && <Alert type="error" message={error} showIcon />}

        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExport}
          loading={loading}
          disabled={!canExport}
          size="large"
        >
          Create Backup
        </Button>
      </Space>
    </Card>
  );
};

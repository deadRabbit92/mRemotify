import React, { useState } from 'react';
import { Card, Upload, Button, Input, Radio, Space, Typography, Alert, Descriptions, message } from 'antd';
import { UploadOutlined, ImportOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import api from '../../api/client';

const { Text } = Typography;

interface PreviewData {
  exported_at: string;
  exported_by: string;
  folders: number;
  connections: number;
  profiles: number;
}

interface RestoreResult {
  imported: { folders: number; connections: number; profiles: number };
  skipped: number;
}

export const BackupRestore: React.FC = () => {
  const [file, setFile] = useState<UploadFile | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const resetState = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const handleDecrypt = async () => {
    if (!file?.originFileObj || !passphrase) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('passphrase', passphrase);
      formData.append('preview', 'true');
      formData.append('file', file.originFileObj);

      const res = await api.post('/import/backup', formData);

      setPreview(res.data);
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.error === 'invalid_passphrase') {
        setError('Wrong passphrase — could not decrypt the backup file');
      } else {
        setError(data?.message || 'Failed to read backup file');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!file?.originFileObj || !passphrase) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('passphrase', passphrase);
      formData.append('mode', mode);
      formData.append('file', file.originFileObj);

      const res = await api.post('/import/backup', formData);

      setResult(res.data);
      setPreview(null);
      message.success('Restore completed successfully');

      // Reload page to refresh connection tree
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  const totalItems = preview ? preview.connections + preview.folders + preview.profiles : 0;

  return (
    <Card title="Import / Restore" type="inner">
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Upload
          accept=".mrb"
          maxCount={1}
          beforeUpload={(f) => {
            setFile({ ...f, originFileObj: f } as any);
            resetState();
            return false;
          }}
          onRemove={() => {
            setFile(null);
            setPassphrase('');
            resetState();
          }}
          fileList={file ? [file] : []}
        >
          <Button icon={<UploadOutlined />}>Select .mrb backup file</Button>
        </Upload>

        {file && !preview && !result && (
          <Space.Compact style={{ maxWidth: 400 }}>
            <Input.Password
              placeholder="Backup passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onPressEnter={handleDecrypt}
            />
            <Button type="primary" onClick={handleDecrypt} loading={loading} disabled={!passphrase}>
              Decrypt
            </Button>
          </Space.Compact>
        )}

        {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}

        {preview && (
          <>
            <Descriptions bordered size="small" column={1} style={{ maxWidth: 400 }}>
              <Descriptions.Item label="Exported at">
                {new Date(preview.exported_at).toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label="Exported by">{preview.exported_by}</Descriptions.Item>
              <Descriptions.Item label="Folders">{preview.folders}</Descriptions.Item>
              <Descriptions.Item label="Connections">{preview.connections}</Descriptions.Item>
              <Descriptions.Item label="Profiles">{preview.profiles}</Descriptions.Item>
            </Descriptions>

            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Import mode</Text>
              <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
                <Space direction="vertical">
                  <Radio value="merge">Merge — add to existing data, skip duplicates</Radio>
                  <Radio value="replace">Replace — delete all existing data first</Radio>
                </Space>
              </Radio.Group>
            </div>

            {mode === 'replace' && (
              <Alert
                type="error"
                message="Warning: This will delete all your existing connections, folders, and profiles before restoring from the backup."
                showIcon
              />
            )}

            <Button
              type="primary"
              icon={<ImportOutlined />}
              onClick={handleRestore}
              loading={loading}
              size="large"
              danger={mode === 'replace'}
            >
              Restore {preview.connections} connection{preview.connections !== 1 ? 's' : ''}
            </Button>
          </>
        )}

        {result && (
          <Alert
            type="success"
            message="Restore Complete"
            description={`Restored ${result.imported.connections} connections, ${result.imported.folders} folders, ${result.imported.profiles} profiles.${result.skipped > 0 ? ` ${result.skipped} skipped (duplicates).` : ''}`}
            showIcon
          />
        )}
      </Space>
    </Card>
  );
};

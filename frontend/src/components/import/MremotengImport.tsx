import React, { useState } from 'react';
import { Card, Upload, Button, Input, Checkbox, Alert, Space, Typography, message } from 'antd';
import { UploadOutlined, ImportOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { MremotengPreviewTree } from './MremotengPreviewTree';
import api from '../../api/client';

const { Text } = Typography;

interface PreviewData {
  folders: any[];
  connections: any[];
  totalConnections: number;
  totalFolders: number;
  warnings: string[];
}

interface ImportResult {
  imported: { connections: number; folders: number };
  skipped: number;
  warnings: string[];
}

export const MremotengImport: React.FC = () => {
  const [file, setFile] = useState<UploadFile | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [importIntoFolder, setImportIntoFolder] = useState(true);
  const [folderName, setFolderName] = useState('mRemoteNG Import');
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setNeedsPassword(false);
    setMasterPassword('');
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const uploadAndPreview = async (fileObj: File, password?: string) => {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('preview', 'true');
      if (password) formData.append('masterPassword', password);
      formData.append('file', fileObj);

      const res = await api.post('/import/mremoteng', formData);

      setPreview(res.data);
      setNeedsPassword(false);

      // Set default folder name from filename
      const name = fileObj.name.replace(/\.xml$/i, '');
      setFolderName(name);
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.error === 'encrypted') {
        setNeedsPassword(true);
        setPreview(null);
      } else {
        const status = err.response?.status;
        const msg = data?.message || (status ? `Server error (${status})` : err.message || 'Failed to parse file');
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (uploadFile: UploadFile) => {
    setFile(uploadFile);
    resetState();
    if (uploadFile.originFileObj) {
      uploadAndPreview(uploadFile.originFileObj);
    }
    return false; // prevent auto upload
  };

  const handlePasswordSubmit = () => {
    if (file?.originFileObj && masterPassword) {
      uploadAndPreview(file.originFileObj, masterPassword);
    }
  };

  const handleImport = async () => {
    if (!file?.originFileObj) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      if (masterPassword) formData.append('masterPassword', masterPassword);
      formData.append('importIntoFolder', String(importIntoFolder));
      formData.append('folderName', folderName);
      formData.append('skipDuplicates', String(skipDuplicates));
      formData.append('file', file.originFileObj);

      const res = await api.post('/import/mremoteng', formData);

      setResult(res.data);
      setPreview(null);
      message.success('Import completed successfully');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="mRemoteNG Import" style={{ marginBottom: 24 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Upload
          accept=".xml"
          maxCount={1}
          beforeUpload={(f) => { handleFileSelect({ ...f, originFileObj: f } as any); return false; }}
          onRemove={() => { setFile(null); resetState(); }}
          fileList={file ? [file] : []}
        >
          <Button icon={<UploadOutlined />}>Select confCons.xml file</Button>
        </Upload>

        {needsPassword && (
          <Alert
            type="warning"
            message="This file is encrypted"
            description={
              <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
                <Text>Enter your mRemoteNG master password to decrypt:</Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Input.Password
                    placeholder="Master password"
                    value={masterPassword}
                    onChange={(e) => setMasterPassword(e.target.value)}
                    onPressEnter={handlePasswordSubmit}
                    style={{ flex: 1 }}
                  />
                  <Button type="primary" onClick={handlePasswordSubmit} loading={loading}>
                    Decrypt
                  </Button>
                </Space.Compact>
              </Space>
            }
          />
        )}

        {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}

        {preview && (
          <>
            <MremotengPreviewTree folders={preview.folders} connections={preview.connections} />

            {preview.warnings.length > 0 && (
              <Alert
                type="warning"
                message="Warnings"
                description={
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                }
              />
            )}

            <Space direction="vertical">
              <Checkbox checked={importIntoFolder} onChange={(e) => setImportIntoFolder(e.target.checked)}>
                Import into a new root folder named:
              </Checkbox>
              {importIntoFolder && (
                <Input
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  style={{ width: 300, marginLeft: 24 }}
                />
              )}
              <Checkbox checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)}>
                Skip connections with duplicate hostnames
              </Checkbox>
            </Space>

            <Button
              type="primary"
              icon={<ImportOutlined />}
              onClick={handleImport}
              loading={loading}
              size="large"
            >
              Import {preview.totalConnections} connection{preview.totalConnections !== 1 ? 's' : ''}
            </Button>
          </>
        )}

        {result && (
          <Alert
            type="success"
            message="Import Complete"
            description={`Imported ${result.imported.connections} connection${result.imported.connections !== 1 ? 's' : ''} into ${result.imported.folders} folder${result.imported.folders !== 1 ? 's' : ''}.${result.skipped > 0 ? ` ${result.skipped} skipped (duplicates).` : ''}`}
            showIcon
          />
        )}
      </Space>
    </Card>
  );
};

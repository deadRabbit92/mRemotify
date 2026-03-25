import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Table, Breadcrumb, Button, Space, Upload, Input, Modal, message, Tooltip, Typography } from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  UploadOutlined,
  ReloadOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useStore } from '../../store';
import { Session } from '../../types';

interface Props {
  session: Session;
}

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modTime: number;
}

function humanSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function getWsUrl(connectionId: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/ws/sftp/${connectionId}?token=${encodeURIComponent(token)}`;
}

function joinPath(base: string, name: string): string {
  if (base === '/') return '/' + name;
  return base + '/' + name;
}

function parentPath(path: string): string {
  if (path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
}

function pathSegments(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  const segments: { name: string; path: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    segments.push({
      name: parts[i],
      path: '/' + parts.slice(0, i + 1).join('/'),
    });
  }
  return segments;
}

export const SftpTab: React.FC<Props> = ({ session }) => {
  const token = useStore((s) => s.token) ?? '';
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [homePath, setHomePath] = useState('/');

  // Keep a ref to currentPath so WebSocket handlers always see the latest value
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  // Download state
  const downloadRef = useRef<{ name: string; size: number; chunks: ArrayBuffer[] } | null>(null);

  // Upload state
  const uploadingRef = useRef(false);

  // New folder state
  const [mkdirModalOpen, setMkdirModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Rename state
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState('');

  const sendJson = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const listDir = useCallback(
    (path: string) => {
      setLoading(true);
      sendJson({ type: 'list', path });
    },
    [sendJson]
  );

  const navigateTo = useCallback(
    (path: string) => {
      setCurrentPath(path);
      listDir(path);
    },
    [listDir]
  );

  // WebSocket lifecycle
  useEffect(() => {
    const url = getWsUrl(session.connection.id, token);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (event) => {
      // Binary frame → download chunk
      if (event.data instanceof ArrayBuffer) {
        if (downloadRef.current) {
          downloadRef.current.chunks.push(event.data as ArrayBuffer);
        }
        return;
      }

      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'ready':
          setConnected(true);
          setHomePath(msg.home || '/');
          currentPathRef.current = msg.home || '/';
          setCurrentPath(msg.home || '/');
          setLoading(true);
          ws.send(JSON.stringify({ type: 'list', path: msg.home || '/' }));
          break;

        case 'entries': {
          const serverEntries: FileEntry[] = msg.entries || [];
          if (msg.path !== '/') {
            serverEntries.unshift({ name: '..', isDir: true, size: 0, modTime: 0 });
          }
          setEntries(serverEntries);
          currentPathRef.current = msg.path;
          setCurrentPath(msg.path);
          setLoading(false);
          break;
        }

        case 'downloadStart':
          downloadRef.current = { name: msg.name, size: msg.size, chunks: [] };
          break;

        case 'downloadEnd': {
          const dl = downloadRef.current;
          if (dl) {
            const blob = new Blob(dl.chunks);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = dl.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            downloadRef.current = null;
          }
          break;
        }

        case 'ok': {
          if (uploadingRef.current) {
            uploadingRef.current = false;
            message.success('Upload complete');
          }
          // Refresh listing using ws directly (no closure dependencies).
          // Server sends path in 'ok'; fall back to ref if absent.
          const refreshPath = msg.path || currentPathRef.current;
          currentPathRef.current = refreshPath;
          setCurrentPath(refreshPath);
          setLoading(true);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'list', path: refreshPath }));
          }
          break;
        }

        case 'error':
          setLoading(false);
          uploadingRef.current = false;
          message.error(msg.message || 'SFTP error');
          break;
      }
    };

    ws.onerror = () => {
      message.error('SFTP WebSocket error');
    };

    ws.onclose = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.connection.id, token]);

  // --- Handlers ---
  const handleDownload = (entry: FileEntry) => {
    sendJson({ type: 'download', path: joinPath(currentPath, entry.name) });
  };

  const handleDelete = (entry: FileEntry) => {
    Modal.confirm({
      title: `Delete "${entry.name}"?`,
      content: entry.isDir ? 'This will delete the directory (must be empty).' : 'This file will be permanently deleted.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => {
        sendJson({ type: 'delete', path: joinPath(currentPath, entry.name) });
      },
    });
  };

  const handleRename = (entry: FileEntry) => {
    setRenameEntry(entry);
    setRenameName(entry.name);
    setRenameModalOpen(true);
  };

  const commitRename = () => {
    if (renameEntry && renameName.trim() && renameName !== renameEntry.name) {
      sendJson({
        type: 'rename',
        oldPath: joinPath(currentPath, renameEntry.name),
        newPath: joinPath(currentPath, renameName.trim()),
      });
    }
    setRenameModalOpen(false);
    setRenameEntry(null);
    setRenameName('');
  };

  const handleMkdir = () => {
    if (newFolderName.trim()) {
      sendJson({ type: 'mkdir', path: joinPath(currentPath, newFolderName.trim()) });
    }
    setMkdirModalOpen(false);
    setNewFolderName('');
  };

  const handleUpload = (file: File) => {
    uploadingRef.current = true;
    const uploadPath = joinPath(currentPath, file.name);
    sendJson({ type: 'upload', path: uploadPath, size: file.size });

    const reader = new FileReader();
    reader.onload = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && reader.result instanceof ArrayBuffer) {
        // Send in 64KB chunks
        const data = new Uint8Array(reader.result);
        const CHUNK = 64 * 1024;
        for (let offset = 0; offset < data.length; offset += CHUNK) {
          ws.send(data.slice(offset, offset + CHUNK));
        }
        sendJson({ type: 'uploadEnd' });
      }
    };
    reader.readAsArrayBuffer(file);
    return false; // Prevent Ant Upload from doing its own upload
  };

  // --- Table columns ---
  const columns: ColumnsType<FileEntry> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <span
          style={{ cursor: record.isDir ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => record.isDir && navigateTo(name === '..' ? parentPath(currentPath) : joinPath(currentPath, name))}
        >
          {record.isDir ? <FolderOutlined style={{ color: name === '..' ? undefined : '#faad14' }} /> : <FileOutlined />}
          <span style={{ color: record.isDir ? '#1677ff' : undefined }}>{name}</span>
        </span>
      ),
      sorter: (a, b) => {
        if (a.name === '..') return -1;
        if (b.name === '..') return 1;
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      },
      defaultSortOrder: 'ascend',
    },
    {
      title: 'Size',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (size: number, record) => (record.isDir ? '—' : humanSize(size)),
      sorter: (a, b) => a.size - b.size,
    },
    {
      title: 'Modified',
      dataIndex: 'modTime',
      key: 'modTime',
      width: 180,
      render: (ms: number) => formatDate(ms),
      sorter: (a, b) => a.modTime - b.modTime,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_, record) => record.name === '..' ? null : (
        <Space size="small">
          {!record.isDir && (
            <Tooltip title="Download">
              <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(record)} />
            </Tooltip>
          )}
          <Tooltip title="Rename">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleRename(record)} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const segments = pathSegments(currentPath);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--mr-bg-surface)' }}>
      {/* Toolbar */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--mr-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Breadcrumb
          style={{ flex: 1, minWidth: 0 }}
          items={[
            {
              title: (
                <span style={{ cursor: 'pointer' }} onClick={() => navigateTo('/')}>
                  <HomeOutlined />
                </span>
              ),
            },
            ...segments.map((seg) => ({
              title: (
                <span style={{ cursor: 'pointer' }} onClick={() => navigateTo(seg.path)}>
                  {seg.name}
                </span>
              ),
            })),
          ]}
        />
        <Space size="small">
          <Upload beforeUpload={handleUpload as any} showUploadList={false} multiple={false}>
            <Button size="small" icon={<UploadOutlined />}>
              Upload
            </Button>
          </Upload>
          <Button
            size="small"
            icon={<FolderAddOutlined />}
            onClick={() => {
              setNewFolderName('');
              setMkdirModalOpen(true);
            }}
          >
            New Folder
          </Button>
          <Tooltip title="Refresh">
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => listDir(currentPath)} />
          </Tooltip>
        </Space>
      </div>

      {/* File table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
        {!connected ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Typography.Text type="secondary">Connecting to SFTP...</Typography.Text>
          </div>
        ) : (
          <Table<FileEntry>
            dataSource={entries}
            columns={columns}
            rowKey="name"
            size="small"
            loading={loading}
            pagination={false}
            locale={{ emptyText: 'Empty directory' }}
            onRow={(record) => ({
              onDoubleClick: () => {
                if (record.isDir) navigateTo(record.name === '..' ? parentPath(currentPath) : joinPath(currentPath, record.name));
              },
            })}
          />
        )}
      </div>

      {/* New Folder Modal */}
      <Modal
        title="New Folder"
        open={mkdirModalOpen}
        onOk={handleMkdir}
        onCancel={() => setMkdirModalOpen(false)}
        okText="Create"
      >
        <Input
          placeholder="Folder name"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onPressEnter={handleMkdir}
          autoFocus
        />
      </Modal>

      {/* Rename Modal */}
      <Modal
        title={`Rename "${renameEntry?.name}"`}
        open={renameModalOpen}
        onOk={commitRename}
        onCancel={() => setRenameModalOpen(false)}
        okText="Rename"
      >
        <Input
          placeholder="New name"
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={commitRename}
          autoFocus
        />
      </Modal>
    </div>
  );
};

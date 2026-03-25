import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Tree,
  Button,
  Dropdown,
  Typography,
  Tooltip,
  Input,
  message,
} from 'antd';
import type { DataNode, DirectoryTreeProps } from 'antd/es/tree';
import type { MenuProps } from 'antd';
import {
  FolderOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  WindowsOutlined,
  CodeOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  FolderAddOutlined,
  SearchOutlined,
  IdcardOutlined,
} from '@ant-design/icons';
import { useStore } from '../../store';
import {
  apiFolderList,
  apiFolderCreate,
  apiFolderDelete,
  apiFolderUpdate,
  apiConnectionList,
  apiConnectionCreate,
  apiConnectionDelete,
  apiConnectionUpdate,
  apiProfileList,
} from '../../api/client';
import { Connection, ConnectionFormValues, Folder } from '../../types';
import { ConnectionModal } from '../Modals/ConnectionModal';

interface TreeItemData {
  type: 'folder' | 'connection';
  folder?: Folder;
  connection?: Connection;
}

interface ExtendedDataNode extends DataNode {
  itemData: TreeItemData;
  children?: ExtendedDataNode[];
}

const OsIcon: React.FC<{ osType?: string | null }> = ({ osType }) => {
  if (osType === 'windows') return <WindowsOutlined />;
  return <CodeOutlined />;
};

function buildTree(
  folders: Folder[],
  connections: Connection[],
  parentId: string | null = null
): ExtendedDataNode[] {
  const subFolders: ExtendedDataNode[] = folders
    .filter((f) => f.parentId === parentId)
    .map((folder) => ({
      key: `folder-${folder.id}`,
      title: folder.name,
      isLeaf: false,
      itemData: { type: 'folder' as const, folder },
      children: buildTree(folders, connections, folder.id),
    }));

  const leafConnections: ExtendedDataNode[] = connections
    .filter((c) => c.folderId === parentId)
    .map((connection) => ({
      key: `connection-${connection.id}`,
      title: connection.name,
      isLeaf: true,
      icon: <OsIcon osType={connection.osType} />,
      itemData: { type: 'connection' as const, connection },
    }));

  return [...subFolders, ...leafConnections];
}

export const ConnectionTree: React.FC = () => {
  const folders = useStore((s) => s.folders);
  const connections = useStore((s) => s.connections);
  const setFolders = useStore((s) => s.setFolders);
  const setConnections = useStore((s) => s.setConnections);
  const profiles = useStore((s) => s.profiles);
  const setProfiles = useStore((s) => s.setProfiles);
  const openSession = useStore((s) => s.openSession);
  const selectedConnectionId = useStore((s) => s.selectedConnectionId);
  const setSelectedConnection = useStore((s) => s.setSelectedConnection);

  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const searchInputRef = useRef<ReturnType<typeof Input.Search>>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<any>(null);
  const [treeHeight, setTreeHeight] = useState(400);

  // Find all connections matching the search query (min 3 chars)
  const searchMatches = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3) return [];
    const q = trimmed.toLowerCase();
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q)
    );
  }, [searchQuery, connections]);

  // Auto-select the first match when query or matches change
  useEffect(() => {
    if (searchMatches.length > 0) {
      const idx = Math.min(searchMatchIndex, searchMatches.length - 1);
      setSelectedConnection(searchMatches[idx].id);
      setSearchMatchIndex(idx);
    }
  }, [searchMatches, searchMatchIndex, setSelectedConnection]);

  // Scroll the selected match into view using the Tree's virtual scroll API
  useEffect(() => {
    if (!selectedConnectionId || searchMatches.length === 0) return;
    const raf = requestAnimationFrame(() => {
      treeRef.current?.scrollTo({ key: `connection-${selectedConnectionId}` });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedConnectionId, searchMatchIndex, searchMatches.length]);

  // Compute expanded folder keys so matched connections inside folders are visible
  const searchExpandedKeys = useMemo(() => {
    if (searchQuery.trim().length < 3 || searchMatches.length === 0) return undefined;
    const keys = new Set<string>();
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    for (const conn of searchMatches) {
      let fid = conn.folderId;
      while (fid) {
        keys.add(`folder-${fid}`);
        fid = folderMap.get(fid)?.parentId ?? null;
      }
    }
    return [...keys];
  }, [searchQuery, searchMatches, folders]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchMatches.length > 0)
        setSearchMatchIndex((i) => (i + 1) % searchMatches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchMatches.length > 0)
        setSearchMatchIndex((i) => (i - 1 + searchMatches.length) % searchMatches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchMatches.length > 0) {
        const idx = Math.min(searchMatchIndex, searchMatches.length - 1);
        openSession(searchMatches[idx]);
      }
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      setSearchMatchIndex(0);
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, cRes, pRes] = await Promise.all([apiFolderList(), apiConnectionList(), apiProfileList()]);
      setFolders(fRes.data);
      setConnections(cRes.data);
      setProfiles(pRes.data);
    } catch {
      message.error('Failed to load connections');
    } finally {
      setLoading(false);
    }
  }, [setFolders, setConnections, setProfiles]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Track container height for virtual scrolling
  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setTreeHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const treeData = useMemo(() => buildTree(folders, connections), [folders, connections]);

  // --- Drop: move connection into folder ---
  const onDrop: DirectoryTreeProps['onDrop'] = async (info) => {
    const dragNode = info.dragNode as unknown as ExtendedDataNode;
    const dropNode = info.node as unknown as ExtendedDataNode;
    if (dragNode.itemData.type !== 'connection') return;

    const connectionId = dragNode.itemData.connection!.id;
    let targetFolderId: string | null = null;

    if (dropNode.itemData.type === 'folder') {
      targetFolderId = dropNode.itemData.folder!.id;
    } else if (dropNode.itemData.type === 'connection') {
      targetFolderId = dropNode.itemData.connection!.folderId ?? null;
    }

    try {
      await apiConnectionUpdate(connectionId, { folderId: targetFolderId });
      await refresh();
    } catch {
      message.error('Failed to move connection');
    }
  };

  // --- Single-click: select connection for properties panel ---
  const onSelect = useCallback((selectedKeys: React.Key[], info: { node: DataNode }) => {
    const ext = info.node as ExtendedDataNode;
    if (ext.itemData.type === 'connection') {
      setSelectedConnection(ext.itemData.connection!.id);
    } else {
      setSelectedConnection(null);
    }
  }, [setSelectedConnection]);

  // --- Double-click: open session ---
  const onDoubleClick = useCallback((_: React.MouseEvent, node: DataNode) => {
    const ext = node as ExtendedDataNode;
    if (ext.itemData.type === 'connection') {
      openSession(ext.itemData.connection!);
    }
  }, [openSession]);

  // --- Context menu items ---
  const getContextMenu = (node: ExtendedDataNode): MenuProps['items'] => {
    if (node.itemData.type === 'connection') {
      const conn = node.itemData.connection!;
      return [
        {
          key: 'connect',
          label: 'Connect',
          onClick: () => openSession(conn, undefined, true),
        },
        ...(conn.protocol === 'ssh'
          ? [
              {
                key: 'browseFiles',
                icon: <FolderOpenOutlined />,
                label: 'Browse Files',
                onClick: () => openSession(conn, 'sftp'),
              },
            ]
          : []),
        {
          key: 'edit',
          icon: <EditOutlined />,
          label: 'Edit',
          onClick: () => {
            setEditingConnection(node.itemData.connection!);
            setModalOpen(true);
          },
        },
        {
          key: 'duplicate',
          icon: <CopyOutlined />,
          label: 'Duplicate',
          onClick: () => {
            const conn = node.itemData.connection!;
            setEditingConnection({
              ...conn,
              id: '', // empty id → modal treats it as create
              name: `${conn.name} (Copy)`,
            });
            setModalOpen(true);
          },
        },
        { type: 'divider' },
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: 'Delete',
          danger: true,
          onClick: async () => {
            try {
              await apiConnectionDelete(node.itemData.connection!.id);
              await refresh();
            } catch {
              message.error('Failed to delete connection');
            }
          },
        },
      ];
    }

    const folder = node.itemData.folder!;
    const sshProfiles = profiles.filter((p) => p.protocol === 'ssh');
    const rdpProfiles = profiles.filter((p) => p.protocol === 'rdp');

    const makeProfileSubmenu = (
      protocol: 'ssh' | 'rdp',
      profileList: typeof profiles,
      currentId: string | null | undefined,
    ): MenuProps['items'] => [
      {
        key: `${protocol}-none`,
        label: 'None (no inheritance)',
        onClick: async () => {
          try {
            const field = protocol === 'ssh' ? 'sshProfileId' : 'rdpProfileId';
            await apiFolderUpdate(folder.id, { [field]: null });
            await refresh();
          } catch { message.error('Failed to update folder'); }
        },
        style: !currentId ? { fontWeight: 'bold' } : undefined,
      },
      { type: 'divider' as const },
      ...profileList.map((p) => ({
        key: `${protocol}-${p.id}`,
        label: p.name,
        onClick: async () => {
          try {
            const field = protocol === 'ssh' ? 'sshProfileId' : 'rdpProfileId';
            await apiFolderUpdate(folder.id, { [field]: p.id });
            await refresh();
            message.success(`${protocol.toUpperCase()} profile set to "${p.name}"`);
          } catch { message.error('Failed to update folder'); }
        },
        style: currentId === p.id ? { fontWeight: 'bold' } : undefined,
      })),
    ];

    return [
      {
        key: 'addConnection',
        icon: <PlusOutlined />,
        label: 'Add connection here',
        onClick: () => {
          setEditingConnection(null);
          setModalOpen(true);
        },
      },
      {
        key: 'addSubfolder',
        icon: <FolderAddOutlined />,
        label: 'Add subfolder',
        onClick: () => {
          setNewFolderParentId(folder.id);
          setAddingFolder(true);
        },
      },
      { type: 'divider' },
      ...(sshProfiles.length > 0
        ? [{
            key: 'sshProfile',
            icon: <IdcardOutlined />,
            label: `SSH Profile${folder.sshProfileId ? ' ✓' : ''}`,
            children: makeProfileSubmenu('ssh', sshProfiles, folder.sshProfileId),
          }]
        : []),
      ...(rdpProfiles.length > 0
        ? [{
            key: 'rdpProfile',
            icon: <IdcardOutlined />,
            label: `RDP Profile${folder.rdpProfileId ? ' ✓' : ''}`,
            children: makeProfileSubmenu('rdp', rdpProfiles, folder.rdpProfileId),
          }]
        : []),
      { type: 'divider' },
      {
        key: 'deleteFolder',
        icon: <DeleteOutlined />,
        label: 'Delete folder',
        danger: true,
        onClick: async () => {
          try {
            await apiFolderDelete(folder.id);
            await refresh();
          } catch {
            message.error('Failed to delete folder');
          }
        },
      },
    ];
  };

  // --- Save connection (create or update) ---
  const handleSave = async (values: ConnectionFormValues, id?: string) => {
    try {
      if (id) {
        await apiConnectionUpdate(id, values);
      } else {
        await apiConnectionCreate(values);
      }
      setModalOpen(false);
      setEditingConnection(null);
      await refresh();
    } catch {
      message.error('Failed to save connection');
    }
  };

  // --- Add folder ---
  const commitNewFolder = async () => {
    if (!newFolderName.trim()) {
      setAddingFolder(false);
      setNewFolderName('');
      return;
    }
    try {
      await apiFolderCreate({ name: newFolderName.trim(), parentId: newFolderParentId });
      await refresh();
    } catch {
      message.error('Failed to create folder');
    } finally {
      setAddingFolder(false);
      setNewFolderName('');
      setNewFolderParentId(null);
    }
  };

  const treeIcon = useCallback((node: unknown) => {
    const ext = node as ExtendedDataNode;
    if (ext.itemData?.type === 'folder') {
      return (node as { expanded?: boolean }).expanded ? (
        <FolderOpenOutlined />
      ) : (
        <FolderOutlined />
      );
    }
    return null;
  }, []);

  // Stable ref so titleRender can access latest getContextMenu without re-creating
  const getContextMenuRef = useRef(getContextMenu);
  getContextMenuRef.current = getContextMenu;

  const titleRender = useCallback((node: DataNode) => {
    const ext = node as ExtendedDataNode;
    const menuProps = { items: getContextMenuRef.current(ext) };
    return (
      <Dropdown menu={menuProps} trigger={['contextMenu']}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {String(node.title)}
          </span>
          <Dropdown menu={menuProps} trigger={['click']}>
            <MoreOutlined
              onClick={(e) => e.stopPropagation()}
              style={{ opacity: 0.45, fontSize: 12 }}
            />
          </Dropdown>
        </span>
      </Dropdown>
    );
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div
        className="sidebar-toolbar"
        style={{
          padding: '8px 8px 4px',
          borderBottom: '1px solid var(--mr-border)',
          display: 'flex',
          gap: 4,
        }}
      >
        <Tooltip title="New connection">
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingConnection(null);
              setModalOpen(true);
            }}
          />
        </Tooltip>
        <Tooltip title="New folder">
          <Button
            size="small"
            icon={<FolderAddOutlined />}
            onClick={() => {
              setNewFolderParentId(null);
              setAddingFolder(true);
            }}
          />
        </Tooltip>
        <Tooltip title="Refresh">
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={refresh} />
        </Tooltip>
        <Input
          ref={searchInputRef as React.Ref<any>}
          size="small"
          placeholder="Search…"
          prefix={<SearchOutlined style={{ color: 'var(--mr-text-muted)' }} />}
          allowClear
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setSearchMatchIndex(0); }}
          onKeyDown={handleSearchKeyDown}
          style={{ flex: 1, minWidth: 0 }}
          suffix={searchQuery && searchMatches.length > 0 ? (
            <span style={{ fontSize: 11, color: 'var(--mr-text-muted)', whiteSpace: 'nowrap' }}>
              {Math.min(searchMatchIndex + 1, searchMatches.length)}/{searchMatches.length}
            </span>
          ) : undefined}
        />
      </div>

      {/* Inline folder name input */}
      {addingFolder && (
        <div style={{ padding: '4px 8px' }}>
          <Input
            size="small"
            autoFocus
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onPressEnter={commitNewFolder}
            onBlur={commitNewFolder}
          />
        </div>
      )}

      {/* Tree */}
      <div ref={treeContainerRef} className="sidebar-tree" style={{ flex: 1, overflow: 'hidden', padding: '4px 0' }}>
        {treeData.length === 0 && !loading ? (
          <Typography.Text style={{ padding: '8px 16px', display: 'block', color: 'var(--mr-text-muted)' }}>
            No connections yet. Click + to add one.
          </Typography.Text>
        ) : (
          <Tree
            ref={treeRef}
            treeData={treeData}
            virtual
            height={treeHeight}
            draggable={{ icon: false }}
            blockNode
            showIcon
            selectedKeys={selectedConnectionId ? [`connection-${selectedConnectionId}`] : []}
            {...(searchExpandedKeys ? { expandedKeys: searchExpandedKeys } : {})}
            onSelect={onSelect}
            onDrop={onDrop}
            onDoubleClick={onDoubleClick}
            titleRender={titleRender}
            icon={treeIcon}
          />
        )}
      </div>

      <ConnectionModal
        open={modalOpen}
        connection={editingConnection}
        folders={folders}
        profiles={profiles}
        onClose={() => {
          setModalOpen(false);
          setEditingConnection(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
};

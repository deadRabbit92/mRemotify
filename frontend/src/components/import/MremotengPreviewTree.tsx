import React from 'react';
import { Tree, Tag } from 'antd';
import { FolderOutlined, DesktopOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';

interface PreviewFolder {
  name: string;
  children: PreviewFolder[];
  connections: PreviewConnection[];
}

interface PreviewConnection {
  name: string;
  host: string;
  port: number;
  protocol: string;
  osType: string;
}

interface Props {
  folders: PreviewFolder[];
  connections: PreviewConnection[];
}

let keyCounter = 0;

function buildTreeData(folders: PreviewFolder[], connections: PreviewConnection[]): DataNode[] {
  const nodes: DataNode[] = [];

  for (const folder of folders) {
    const children = buildTreeData(folder.children, folder.connections);
    nodes.push({
      key: `folder-${keyCounter++}`,
      title: folder.name,
      icon: <FolderOutlined />,
      children,
    });
  }

  for (const conn of connections) {
    nodes.push({
      key: `conn-${keyCounter++}`,
      title: (
        <span>
          {conn.name}{' '}
          <Tag color={conn.protocol === 'rdp' ? 'blue' : 'green'} style={{ marginLeft: 4 }}>
            {conn.protocol.toUpperCase()}
          </Tag>
          <span style={{ color: 'var(--mr-text-muted)', fontSize: 12 }}>{conn.host}:{conn.port}</span>
        </span>
      ),
      icon: <DesktopOutlined />,
      isLeaf: true,
    });
  }

  return nodes;
}

export const MremotengPreviewTree: React.FC<Props> = ({ folders, connections }) => {
  keyCounter = 0;
  const treeData = buildTreeData(folders, connections);

  if (treeData.length === 0) return null;

  return (
    <Tree
      showIcon
      defaultExpandAll
      treeData={treeData}
      style={{ maxHeight: 400, overflow: 'auto' }}
    />
  );
};

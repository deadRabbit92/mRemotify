import React, { useState } from 'react';
import { Tabs, Typography, Dropdown, theme } from 'antd';
import type { MenuProps, TabsProps } from 'antd';
import {
  CodeOutlined,
  WindowsOutlined,
  FolderOutlined,
  CopyOutlined,
  ReloadOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import { useStore } from '../../store';
import { SshTab } from './SshTab';
import { RdpTab } from './RdpTab';
import { SftpTab } from './SftpTab';
import { Session } from '../../types';

function TabLabel({ session }: { session: Session }) {
  const closeSession = useStore((s) => s.closeSession);
  const duplicateSession = useStore((s) => s.duplicateSession);
  const reconnectSession = useStore((s) => s.reconnectSession);

  const isSftp = session.mode === 'sftp';
  const icon = isSftp ? (
    <FolderOutlined />
  ) : session.connection.protocol === 'rdp' ? (
    <WindowsOutlined />
  ) : (
    <CodeOutlined />
  );

  const contextMenu: MenuProps = {
    items: [
      {
        key: 'duplicate',
        icon: <CopyOutlined />,
        label: 'Duplicate',
        onClick: () => duplicateSession(session.id),
      },
      {
        key: 'reconnect',
        icon: <ReloadOutlined />,
        label: 'Reconnect',
        onClick: () => reconnectSession(session.id),
      },
      { type: 'divider' },
      {
        key: 'disconnect',
        icon: <DisconnectOutlined />,
        label: 'Disconnect',
        danger: true,
        onClick: () => closeSession(session.id),
      },
    ],
  };

  return (
    <Dropdown menu={contextMenu} trigger={['contextMenu']}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {icon}
        {session.connection.name}{isSftp ? ' (Files)' : ''}
      </span>
    </Dropdown>
  );
}

/** Where a dragged tab would land relative to the tab currently hovered. */
type DropHint = { key: string; position: 'before' | 'after' };

/** Drop before the hovered tab when the pointer is in its left half, after otherwise. */
function dropPosition(e: React.DragEvent<HTMLDivElement>): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

export const SessionTabs: React.FC = () => {
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const closeSession = useStore((s) => s.closeSession);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const moveSession = useStore((s) => s.moveSession);
  const { token } = theme.useToken();

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  // Make every tab in the bar draggable. rc-tabs lets the tab bar's children be
  // a render function that wraps each tab node, so we clone the node and add
  // native HTML5 drag handlers — no extra dependency needed.
  const renderTabBar: TabsProps['renderTabBar'] = (tabBarProps, DefaultTabBar) => (
    <DefaultTabBar {...tabBarProps}>
      {(node) => {
        const tabNode = node as React.ReactElement<React.HTMLAttributes<HTMLDivElement>>;
        const key = String(node.key);
        const hint = dropHint?.key === key ? dropHint.position : null;

        return React.cloneElement(tabNode, {
          draggable: true,
          onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key);
            setDragKey(key);
          },
          onDragEnd: () => {
            setDragKey(null);
            setDropHint(null);
          },
          onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
            // Only react to a tab being dragged — ignore files dropped on the window
            if (!dragKey || dragKey === key) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const position = dropPosition(e);
            setDropHint((prev) =>
              prev && prev.key === key && prev.position === position ? prev : { key, position }
            );
          },
          onDrop: (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            const sourceKey = e.dataTransfer.getData('text/plain') || dragKey;
            if (sourceKey && sourceKey !== key) moveSession(sourceKey, key, dropPosition(e));
            setDragKey(null);
            setDropHint(null);
          },
          style: {
            ...tabNode.props.style,
            cursor: 'grab',
            opacity: dragKey === key ? 0.4 : undefined,
            // Insertion marker on the edge the tab would drop against
            boxShadow: hint
              ? `inset ${hint === 'before' ? '2px' : '-2px'} 0 0 0 ${token.colorPrimary}`
              : undefined,
          },
        });
      }}
    </DefaultTabBar>
  );

  if (sessions.length === 0) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--mr-text-muted)',
          userSelect: 'none',
        }}
      >
        <Typography.Title level={4} type="secondary" style={{ marginBottom: 8 }}>
          No open sessions
        </Typography.Title>
        <Typography.Text type="secondary">
          Double-click a connection in the sidebar to start a session.
        </Typography.Text>
      </div>
    );
  }

  return (
    <Tabs
      type="editable-card"
      hideAdd
      destroyInactiveTabPane={false}
      activeKey={activeSessionId ?? undefined}
      onChange={setActiveSession}
      renderTabBar={renderTabBar}
      onEdit={(key, action) => {
        if (action === 'remove') closeSession(key as string);
      }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      tabBarStyle={{ margin: 0, flexShrink: 0 }}
      items={sessions.map((session) => ({
        key: session.id,
        label: <TabLabel session={session} />,
        closable: true,
        style: { height: '100%', padding: 0 },
        children: (
          <div style={{ height: '100%', overflow: 'hidden' }}>
            {session.mode === 'sftp' ? (
              <SftpTab session={session} />
            ) : session.connection.protocol === 'ssh' ? (
              <SshTab session={session} />
            ) : (
              <RdpTab session={session} />
            )}
          </div>
        ),
      }))}
    />
  );
};

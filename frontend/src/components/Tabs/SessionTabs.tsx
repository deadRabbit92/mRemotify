import React from 'react';
import { Tabs, Typography, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
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

export const SessionTabs: React.FC = () => {
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const closeSession = useStore((s) => s.closeSession);
  const setActiveSession = useStore((s) => s.setActiveSession);

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

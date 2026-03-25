import React from 'react';
import { Layout, Typography, Dropdown, Avatar, Space, Switch } from 'antd';
import {
  UserOutlined,
  LogoutOutlined,
  IdcardOutlined,
  SwapOutlined,
  LockOutlined,
  InfoCircleOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import { ProfileManager } from '../Profiles/ProfileManager';

const { Header } = Layout;

export const TopNav: React.FC = () => {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const darkMode = useStore((s) => s.darkMode);
  const toggleDarkMode = useStore((s) => s.toggleDarkMode);
  const navigate = useNavigate();

  const menuItems: MenuProps['items'] = [
    {
      key: 'profiles',
      icon: <IdcardOutlined />,
      label: 'Connection Profiles',
      onClick: () => useStore.getState().setProfileManagerOpen(true),
    },
    {
      key: 'import-export',
      icon: <SwapOutlined />,
      label: 'Import / Export',
      onClick: () => navigate('/settings/import-export'),
    },
    {
      key: 'change-password',
      icon: <LockOutlined />,
      label: 'Change Password',
      onClick: () => navigate('/settings/change-password'),
    },
    {
      key: 'about',
      icon: <InfoCircleOutlined />,
      label: 'About',
      onClick: () => navigate('/settings/about'),
    },
    { type: 'divider' },
    {
      key: 'theme',
      icon: darkMode ? <SunOutlined /> : <MoonOutlined />,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          Dark mode
          <Switch
            size="small"
            checked={darkMode}
            onChange={toggleDarkMode}
            style={{ pointerEvents: 'none' }}
          />
        </span>
      ),
      onClick: toggleDarkMode,
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign out',
      onClick: logout,
    },
  ];

  return (
    <>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: 'var(--mr-bg-topbar)',
          height: 44,
          lineHeight: '44px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: 'linear-gradient(135deg, #0ea5a0 0%, #06b6d4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: -0.5,
            }}
          >
            m
          </div>
          <Typography.Text
            strong
            style={{
              color: 'var(--mr-text-on-dark-strong)',
              fontSize: 14,
              letterSpacing: -0.3,
            }}
          >
            mRemotify
          </Typography.Text>
        </div>

        <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
          <Space style={{ cursor: 'pointer' }}>
            <Avatar
              size={26}
              style={{
                background: 'var(--mr-accent)',
                fontSize: 12,
              }}
            >
              {user?.username?.charAt(0).toUpperCase()}
            </Avatar>
            <Typography.Text
              style={{
                color: 'var(--mr-text-on-dark)',
                fontSize: 13,
              }}
            >
              {user?.username}
            </Typography.Text>
          </Space>
        </Dropdown>
      </Header>

      <ProfileManager />
    </>
  );
};

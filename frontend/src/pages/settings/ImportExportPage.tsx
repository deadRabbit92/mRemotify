import React from 'react';
import { Layout, Typography, Button, Divider } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { MremotengImport } from '../../components/import/MremotengImport';
import { BackupExport } from '../../components/import/BackupExport';
import { BackupRestore } from '../../components/import/BackupRestore';

const { Content } = Layout;
const { Title } = Typography;

export const ImportExportPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Layout style={{ height: '100vh', background: 'var(--mr-bg-body)' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--mr-bg-topbar)',
          height: 44,
          lineHeight: '44px',
          padding: '0 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ color: 'var(--mr-text-on-dark)', marginRight: 12 }}
        />
        <Typography.Text strong style={{ color: 'var(--mr-text-on-dark-strong)', fontSize: 14 }}>
          Import / Export
        </Typography.Text>
      </Layout.Header>

      <Content style={{ padding: 24, overflow: 'auto', maxWidth: 800, margin: '0 auto', width: '100%' }}>
        <Title level={4}>mRemoteNG Import</Title>
        <MremotengImport />

        <Divider />

        <Title level={4}>mRemotify Backup & Restore</Title>
        <BackupExport />
        <BackupRestore />
      </Content>
    </Layout>
  );
};

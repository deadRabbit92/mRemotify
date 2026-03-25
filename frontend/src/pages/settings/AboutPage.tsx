import React from 'react';
import { Layout, Typography, Button, Descriptions, Tag } from 'antd';
import { ArrowLeftOutlined, GithubOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text, Paragraph, Link } = Typography;

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.3.0';

const LICENSE_TEXT = `MIT License

Copyright (c) 2026 mRemotify Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export const AboutPage: React.FC = () => {
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
        <Text strong style={{ color: 'var(--mr-text-on-dark-strong)', fontSize: 14 }}>
          About
        </Text>
      </Layout.Header>

      <Content style={{ padding: 24, overflow: 'auto', maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #0ea5a0 0%, #06b6d4 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: -1,
              marginBottom: 12,
            }}
          >
            m
          </div>
          <Title level={3} style={{ margin: 0 }}>mRemotify</Title>
          <Tag color="cyan" style={{ marginTop: 8 }}>v{APP_VERSION}</Tag>
          <Paragraph type="secondary" style={{ marginTop: 12 }}>
            A web-based remote connection manager for RDP, SSH, and SFTP.
            Installable as progressive web app.
          </Paragraph>
        </div>

        <Descriptions
          column={1}
          bordered
          size="small"
          style={{ marginBottom: 24 }}
        >
          <Descriptions.Item label="Version">{APP_VERSION}</Descriptions.Item>
          <Descriptions.Item label="License">MIT</Descriptions.Item>
          <Descriptions.Item label="Source Code">
            <Link href="https://gitea.gebauer.services/deadRabbit/mRemotify" target="_blank">
              <GithubOutlined style={{ marginRight: 6 }} />
              gitea.gebauer.services/deadRabbit/mRemotify
            </Link>
          </Descriptions.Item>
          <Descriptions.Item label="Stack">
            React, Ant Design, Fastify, Prisma, Rust
          </Descriptions.Item>
          <Descriptions.Item label="Author">
            mRemotify Contributors
          </Descriptions.Item>
        </Descriptions>

        <Title level={5}>License</Title>
        <pre
          style={{
            background: 'var(--mr-bg-sidebar, rgba(0,0,0,0.04))',
            padding: 16,
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflow: 'auto',
            border: '1px solid var(--mr-border, rgba(0,0,0,0.06))',
          }}
        >
          {LICENSE_TEXT}
        </pre>
      </Content>
    </Layout>
  );
};

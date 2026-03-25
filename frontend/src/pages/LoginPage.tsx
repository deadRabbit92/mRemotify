import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { apiLogin } from '../api/client';
import { useStore } from '../store';

const { Title } = Typography;

export const LoginPage: React.FC = () => {
  const setAuth = useStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { username: string; password: string }) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiLogin(values.username, values.password);
      setAuth(res.data.token, res.data.user);
    } catch {
      setError('Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--mr-bg-body)',
      }}
    >
      <Card style={{ width: 360, boxShadow: 'var(--mr-shadow-dropdown)', background: 'var(--mr-bg-surface)', borderColor: 'var(--mr-border)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'linear-gradient(135deg, #0ea5a0 0%, #06b6d4 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 700,
                color: '#fff',
                letterSpacing: -0.5,
              }}
            >
              m
            </div>
            <Title level={3} style={{ margin: 0 }}>
              mRemotify
            </Title>
          </div>
          <Typography.Text type="secondary">Remote Connection Manager</Typography.Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            closable
            onClose={() => setError(null)}
          />
        )}

        <Form name="login" onFinish={onFinish} layout="vertical" requiredMark={false}>
          <Form.Item name="username" rules={[{ required: true, message: 'Username is required' }]}>
            <Input prefix={<UserOutlined />} placeholder="Username" size="large" autoFocus />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: 'Password is required' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

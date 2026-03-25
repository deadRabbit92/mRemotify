import React, { useState } from 'react';
import { Layout, Typography, Button, Form, Input, Alert } from 'antd';
import { ArrowLeftOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiChangePassword } from '../../api/client';

const { Content } = Layout;

interface ChangePasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const ChangePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm<ChangePasswordForm>();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: ChangePasswordForm) => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await apiChangePassword(values.oldPassword, values.newPassword);
      setSuccess(true);
      form.resetFields();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

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
          Change Password
        </Typography.Text>
      </Layout.Header>

      <Content style={{ padding: 24, overflow: 'auto', maxWidth: 480, margin: '0 auto', width: '100%' }}>
        {success && (
          <Alert
            message="Password changed successfully"
            type="success"
            showIcon
            closable
            onClose={() => setSuccess(false)}
            style={{ marginBottom: 16 }}
          />
        )}
        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 16 }}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          autoComplete="off"
        >
          <Form.Item
            name="oldPassword"
            label="Current Password"
            rules={[{ required: true, message: 'Please enter your current password' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Current password" />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label="New Password"
            rules={[
              { required: true, message: 'Please enter a new password' },
              { min: 6, message: 'Password must be at least 6 characters' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="New password" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="Confirm New Password"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Please confirm your new password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Confirm new password" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              Change Password
            </Button>
          </Form.Item>
        </Form>
      </Content>
    </Layout>
  );
};

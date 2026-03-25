import React, { useEffect, useState } from 'react';
import {
  Drawer,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Tag,
  Space,
  Popconfirm,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useStore } from '../../store';
import { apiProfileList, apiProfileCreate, apiProfileUpdate, apiProfileDelete } from '../../api/client';
import { Profile, ProfileFormValues } from '../../types';

const { TextArea } = Input;
const { Option } = Select;

export const ProfileManager: React.FC = () => {
  const open = useStore((s) => s.profileManagerOpen);
  const setOpen = useStore((s) => s.setProfileManagerOpen);
  const profiles = useStore((s) => s.profiles);
  const setProfiles = useStore((s) => s.setProfiles);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<ProfileFormValues>();
  const protocol = Form.useWatch('protocol', form);

  const refresh = async () => {
    try {
      const res = await apiProfileList();
      setProfiles(res.data);
    } catch {
      message.error('Failed to load profiles');
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const handleOpenCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ protocol: 'ssh', clipboardEnabled: true });
    setModalOpen(true);
  };

  const handleOpenEdit = (profile: Profile) => {
    setEditing(profile);
    form.resetFields();
    form.setFieldsValue({
      name: profile.name,
      protocol: profile.protocol,
      username: profile.username ?? undefined,
      domain: profile.domain ?? undefined,
      clipboardEnabled: profile.clipboardEnabled !== false,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    let values: ProfileFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // Ant Design shows inline field errors
    }

    setLoading(true);
    try {
      if (editing) {
        await apiProfileUpdate(editing.id, values);
      } else {
        await apiProfileCreate(values);
      }
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      await refresh();
    } catch (err: any) {
      const detail = err?.response?.data?.error || err?.message || 'Unknown error';
      message.error(`Failed to save profile: ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiProfileDelete(id);
      await refresh();
    } catch {
      message.error('Failed to delete profile');
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Type',
      dataIndex: 'protocol',
      key: 'protocol',
      width: 80,
      render: (v: string) => (
        <Tag color={v === 'rdp' ? 'blue' : 'green'}>{v.toUpperCase()}</Tag>
      ),
    },
    { title: 'Username', dataIndex: 'username', key: 'username', render: (v: string | null) => v || '-' },
    { title: 'Domain', dataIndex: 'domain', key: 'domain', render: (v: string | null) => v || '-' },
    {
      title: 'Password',
      dataIndex: 'hasPassword',
      key: 'hasPassword',
      width: 90,
      render: (v: boolean) => v ? 'Set' : '-',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Profile) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenEdit(record)}
          />
          <Popconfirm
            title="Delete this profile?"
            description="Connections using it will keep working but lose their profile reference."
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const isEdit = !!editing;

  return (
    <>
      <Drawer
        title="Connection Profiles"
        open={open}
        onClose={() => setOpen(false)}
        width={720}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
            New Profile
          </Button>
        }
      >
        <Table
          dataSource={profiles}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
        />
      </Drawer>

      <Modal
        title={isEdit ? `Edit Profile — ${editing?.name}` : 'New Profile'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        width={480}
        footer={
          <Space>
            <Button onClick={() => { setModalOpen(false); setEditing(null); }}>Cancel</Button>
            <Button type="primary" loading={loading} onClick={handleSave}>
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </Space>
        }
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark="optional" style={{ marginTop: 8 }}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="Production Servers" autoFocus />
          </Form.Item>

          <Form.Item label="Protocol" name="protocol" rules={[{ required: true, message: 'Required' }]}>
            <Select disabled={isEdit}>
              <Option value="ssh">SSH</Option>
              <Option value="rdp">RDP</Option>
            </Select>
          </Form.Item>

          <Form.Item label="Username" name="username">
            <Input placeholder="admin" />
          </Form.Item>

          <Form.Item
            label="Password"
            name="password"
            extra={isEdit ? 'Leave blank to keep the current password' : undefined}
          >
            <Input.Password placeholder="••••••••" autoComplete="new-password" />
          </Form.Item>

          {protocol === 'ssh' && (
            <Form.Item label="Private Key" name="privateKey" extra="PEM-formatted SSH private key">
              <TextArea rows={3} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
            </Form.Item>
          )}

          {protocol === 'rdp' && (
            <Form.Item label="Domain" name="domain">
              <Input placeholder="CORP" />
            </Form.Item>
          )}

          {protocol === 'rdp' && (
            <Form.Item label="Clipboard" name="clipboardEnabled" valuePropName="checked">
              <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
};

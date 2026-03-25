import React, { useEffect, useState } from 'react';
import {
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Tag,
  Typography,
  Switch,
  message,
  Divider,
  Row,
  Col,
} from 'antd';
import { useStore } from '../../store';
import { apiConnectionUpdate } from '../../api/client';
import { ConnectionFormValues, Folder, Profile } from '../../types';

const { Option } = Select;
const { TextArea } = Input;

const buildFolderOptions = (
  allFolders: Folder[],
  parentId: string | null = null,
  depth = 0
): React.ReactNode[] => {
  return allFolders
    .filter((f) => f.parentId === parentId)
    .flatMap((f) => [
      <Option key={f.id} value={f.id}>
        {'\u00a0\u00a0'.repeat(depth)}
        {depth > 0 ? '└ ' : ''}
        {f.name}
      </Option>,
      ...buildFolderOptions(allFolders, f.id, depth + 1),
    ]);
};

export const ConnectionProperties: React.FC = () => {
  const selectedConnectionId = useStore((s) => s.selectedConnectionId);
  const connections = useStore((s) => s.connections);
  const folders = useStore((s) => s.folders);
  const profiles = useStore((s) => s.profiles);
  const setConnections = useStore((s) => s.setConnections);
  const [form] = Form.useForm<ConnectionFormValues>();
  const [saving, setSaving] = useState(false);

  const connection = connections.find((c) => c.id === selectedConnectionId) ?? null;
  const protocol = Form.useWatch('protocol', form);
  const profileId = Form.useWatch('profileId', form);

  // Resolve inherited profile from folder hierarchy
  const inheritedProfile = React.useMemo(() => {
    if (profileId || !connection) return null;
    const proto = protocol || connection.protocol;
    let folderId = connection.folderId;
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    while (folderId) {
      const folder = folderMap.get(folderId);
      if (!folder) break;
      const pid = proto === 'ssh' ? folder.sshProfileId : folder.rdpProfileId;
      if (pid) {
        const profile = profiles.find((p) => p.id === pid);
        if (profile) return profile;
      }
      folderId = folder.parentId;
    }
    return null;
  }, [profileId, connection, protocol, folders, profiles]);

  useEffect(() => {
    if (connection) {
      form.setFieldsValue({
        name: connection.name,
        host: connection.host,
        port: connection.port,
        protocol: connection.protocol,
        username: connection.username,
        privateKey: connection.privateKey ?? undefined,
        domain: connection.domain ?? undefined,
        osType: connection.osType ?? undefined,
        notes: connection.notes ?? undefined,
        clipboardEnabled: connection.clipboardEnabled !== false,
        folderId: connection.folderId ?? null,
        profileId: connection.profileId ?? null,
      });
    } else {
      form.resetFields();
    }
  }, [connection, form]);

  const handleSave = async () => {
    if (!connection) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      const res = await apiConnectionUpdate(connection.id, values);
      // Update connection in store
      setConnections(
        connections.map((c) => (c.id === connection.id ? { ...c, ...res.data } : c))
      );
      message.success('Connection updated');
    } catch {
      message.error('Failed to save connection');
    } finally {
      setSaving(false);
    }
  };

  if (!connection) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          background: 'var(--mr-properties-bg)',
        }}
      >
        <Typography.Text type="secondary">
          Select a connection to view its properties
        </Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '8px 12px', background: 'var(--mr-properties-bg)' }}>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {connection.name}
        </Typography.Text>
        <Tag color={connection.protocol === 'rdp' ? 'blue' : 'green'}>
          {connection.protocol.toUpperCase()}
        </Tag>
      </div>

      <Form form={form} layout="vertical" size="small" requiredMark={false}>
        <Row gutter={8}>
          <Col flex={1}>
            <Form.Item label="Host" name="host" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col style={{ width: 90 }}>
            <Form.Item label="Port" name="port" rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="Protocol" name="protocol" rules={[{ required: true }]}>
          <Select
            onChange={(v: 'ssh' | 'rdp') => form.setFieldValue('port', v === 'ssh' ? 22 : 3389)}
          >
            <Option value="ssh">SSH</Option>
            <Option value="rdp">RDP</Option>
          </Select>
        </Form.Item>

        <Form.Item
          label="Profile"
          name="profileId"
          extra={inheritedProfile ? <Typography.Text type="secondary" style={{ fontSize: 11 }}>Inherited: {inheritedProfile.name} (from folder)</Typography.Text> : undefined}
        >
          <Select allowClear placeholder={inheritedProfile ? `Inherited: ${inheritedProfile.name}` : 'No profile'}>
            {profiles.filter((p) => p.protocol === protocol).map((p) => (
              <Option key={p.id} value={p.id}>{p.name}</Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item label="Username" name="username" rules={[{ required: !profileId && !inheritedProfile, message: 'Required (or select a profile)' }]}>
          <Input placeholder={profileId || inheritedProfile ? 'From profile' : undefined} />
        </Form.Item>

        <Form.Item label="Password" name="password" extra="Leave blank to keep current">
          <Input.Password placeholder="••••••••" autoComplete="new-password" />
        </Form.Item>

        {protocol === 'ssh' && (
          <Form.Item label="Private Key" name="privateKey">
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
            <Switch checkedChildren="On" unCheckedChildren="Off" />
          </Form.Item>
        )}

        <Divider style={{ margin: '4px 0 8px' }} />

        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>

        <Form.Item label="OS Type" name="osType">
          <Select allowClear placeholder="Select OS">
            <Option value="linux">Linux</Option>
            <Option value="windows">Windows</Option>
          </Select>
        </Form.Item>

        <Form.Item label="Folder" name="folderId">
          <Select allowClear placeholder="Root (no folder)">
            {buildFolderOptions(folders)}
          </Select>
        </Form.Item>

        <Form.Item label="Notes" name="notes">
          <TextArea rows={2} placeholder="Optional notes…" />
        </Form.Item>

        <Button type="primary" block onClick={handleSave} loading={saving}>
          Save
        </Button>
      </Form>
    </div>
  );
};

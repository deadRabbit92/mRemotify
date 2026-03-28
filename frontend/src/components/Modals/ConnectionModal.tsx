import React, { useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Space,
  Switch,
  Divider,
  Row,
  Col,
} from 'antd';
import { Connection, ConnectionFormValues, Folder, Profile } from '../../types';

interface Props {
  open: boolean;
  connection?: Connection | null;
  folders: Folder[];
  profiles: Profile[];
  onClose: () => void;
  onSave: (values: ConnectionFormValues, id?: string) => Promise<void>;
}

const { Option } = Select;
const { TextArea } = Input;

export const ConnectionModal: React.FC<Props> = ({
  open,
  connection,
  folders,
  profiles,
  onClose,
  onSave,
}) => {
  const [form] = Form.useForm<ConnectionFormValues>();
  const protocol = Form.useWatch('protocol', form);
  const profileId = Form.useWatch('profileId', form);
  const isEdit = !!connection?.id;

  useEffect(() => {
    if (open) {
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
          scrollbackLines: connection.scrollbackLines ?? undefined,
          folderId: connection.folderId ?? null,
          profileId: connection.profileId ?? null,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ protocol: 'ssh', port: 22, clipboardEnabled: true });
      }
    }
  }, [open, connection, form]);

  const handleProtocolChange = (value: 'ssh' | 'rdp') => {
    form.setFieldValue('port', value === 'ssh' ? 22 : 3389);
    form.setFieldValue('profileId', null);
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    await onSave(values, connection?.id);
    form.resetFields();
  };

  // Build flat folder options with visual indentation
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

  return (
    <Modal
      title={isEdit ? `Edit — ${connection?.name}` : 'New Connection'}
      open={open}
      onCancel={onClose}
      width={520}
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={handleOk}>
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </Space>
      }
      destroyOnClose
    >
      <Form form={form} layout="vertical" requiredMark="optional" style={{ marginTop: 8 }}>
        <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Required' }]}>
          <Input placeholder="My Server" autoFocus />
        </Form.Item>

        <Row gutter={8}>
          <Col flex={1}>
            <Form.Item
              label="Host"
              name="host"
              rules={[{ required: true, message: 'Required' }]}
            >
              <Input placeholder="192.168.1.1" />
            </Form.Item>
          </Col>
          <Col style={{ width: 110 }}>
            <Form.Item
              label="Port"
              name="port"
              rules={[{ required: true, message: 'Required' }]}
            >
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          label="Protocol"
          name="protocol"
          rules={[{ required: true, message: 'Required' }]}
        >
          <Select onChange={handleProtocolChange}>
            <Option value="ssh">SSH</Option>
            <Option value="rdp">RDP</Option>
          </Select>
        </Form.Item>

        <Form.Item label="Profile" name="profileId">
          <Select allowClear placeholder="No profile">
            {profiles.filter((p) => p.protocol === protocol).map((p) => (
              <Option key={p.id} value={p.id}>{p.name}</Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label="Username"
          name="username"
          rules={[{ required: !profileId, message: 'Required (or select a profile)' }]}
        >
          <Input placeholder={profileId ? 'From profile' : 'root'} />
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
            <TextArea rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
          </Form.Item>
        )}

        {protocol === 'ssh' && (
          <Form.Item
            label="Scrollback Lines"
            name="scrollbackLines"
            extra="Number of lines you can scroll back. Leave empty to use profile default (1000)."
          >
            <InputNumber min={0} max={100000} style={{ width: '100%' }} placeholder="1000" />
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

        <Divider style={{ margin: '8px 0' }} />

        <Form.Item label="OS Type" name="osType">
          <Select allowClear placeholder="Select OS (optional)">
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
          <TextArea rows={3} placeholder="Optional notes…" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

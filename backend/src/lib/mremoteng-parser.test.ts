import { describe, it, expect } from 'vitest';
import { parseMremoteng } from './mremoteng-parser';

const UNENCRYPTED_XML = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections"
             Export="false"
             EncryptionEngine="AES"
             BlockCipherMode="GCM"
             KdfIterations="10000"
             FullFileEncryption="false"
             Protected=""
             ConfVersion="2.6">
  <Node Name="Production"
        Type="Container"
        Expanded="True"
        Id="1234">
    <Node Name="Web Server"
          Type="Connection"
          Id="5678"
          Protocol="SSH2"
          Hostname="192.168.1.10"
          Port="22"
          Username="admin"
          Password=""
          Domain=""
          Descr="Main web server"
          Icon="Linux"
          RedirectClipboard="True" />
    <Node Name="DB Server"
          Type="Connection"
          Id="5679"
          Protocol="RDP"
          Hostname="192.168.1.20"
          Port="3389"
          Username="Administrator"
          Password=""
          Domain="CORP"
          Descr=""
          Icon="Windows"
          RedirectClipboard="False" />
  </Node>
  <Node Name="VNC Box"
        Type="Connection"
        Id="9999"
        Protocol="VNC"
        Hostname="192.168.1.30"
        Port="5900"
        Username=""
        Password="" />
</Connections>`;

describe('mremoteng-parser', () => {
  it('parses unencrypted XML with folders and connections', () => {
    const result = parseMremoteng(UNENCRYPTED_XML);

    expect(result.encrypted).toBe(false);
    expect(result.totalConnections).toBe(2);
    expect(result.totalFolders).toBe(1);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].name).toBe('Production');
    expect(result.folders[0].connections).toHaveLength(2);

    const ssh = result.folders[0].connections[0];
    expect(ssh.name).toBe('Web Server');
    expect(ssh.protocol).toBe('ssh');
    expect(ssh.host).toBe('192.168.1.10');
    expect(ssh.port).toBe(22);
    expect(ssh.username).toBe('admin');
    expect(ssh.osType).toBe('linux');
    expect(ssh.notes).toBe('Main web server');

    const rdp = result.folders[0].connections[1];
    expect(rdp.name).toBe('DB Server');
    expect(rdp.protocol).toBe('rdp');
    expect(rdp.host).toBe('192.168.1.20');
    expect(rdp.port).toBe(3389);
    expect(rdp.domain).toBe('CORP');
    expect(rdp.osType).toBe('windows');
    expect(rdp.clipboardEnabled).toBe(false);
  });

  it('skips unsupported protocols and adds warnings', () => {
    const result = parseMremoteng(UNENCRYPTED_XML);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('VNC');
    expect(result.connections).toHaveLength(0); // VNC is root-level and skipped
  });

  it('detects encrypted files and returns encrypted flag', () => {
    const encryptedXml = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections"
             FullFileEncryption="true"
             Protected="somehash"
             KdfIterations="10000">
  SomeBase64EncryptedContent==
</Connections>`;

    const result = parseMremoteng(encryptedXml);
    expect(result.encrypted).toBe(true);
    expect(result.totalConnections).toBe(0);
  });

  it('detects per-field encrypted passwords', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections"
             FullFileEncryption="false"
             Protected=""
             KdfIterations="10000">
  <Node Name="Test"
        Type="Connection"
        Protocol="SSH2"
        Hostname="10.0.0.1"
        Port="22"
        Username="root"
        Password="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/==" />
</Connections>`;

    const result = parseMremoteng(xml);
    expect(result.encrypted).toBe(true);
  });

  it('handles XML with mrng namespace', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<mrng:Connections xmlns:mrng="http://mremoteng.org" Name="Connections"
             FullFileEncryption="false"
             Protected="someHash"
             KdfIterations="10000"
             ConfVersion="2.7">
  <Node Name="Server1" Type="Connection" Protocol="RDP" Hostname="10.0.0.1" Port="3389" Username="admin" Password="" Icon="Windows" RedirectClipboard="true" />
</mrng:Connections>`;

    const result = parseMremoteng(xml);
    expect(result.encrypted).toBe(false);
    expect(result.totalConnections).toBe(1);
    expect(result.connections[0].name).toBe('Server1');
    expect(result.connections[0].protocol).toBe('rdp');
  });

  it('handles empty XML gracefully', () => {
    const xml = `<?xml version="1.0"?>
<Connections Name="Connections" FullFileEncryption="false" Protected="">
</Connections>`;

    const result = parseMremoteng(xml);
    expect(result.encrypted).toBe(false);
    expect(result.totalConnections).toBe(0);
    expect(result.totalFolders).toBe(0);
  });

  it('handles nested folders', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" FullFileEncryption="false" Protected="">
  <Node Name="Level1" Type="Container">
    <Node Name="Level2" Type="Container">
      <Node Name="Deep Server"
            Type="Connection"
            Protocol="SSH2"
            Hostname="10.0.0.1"
            Port="22"
            Username="root"
            Password="" />
    </Node>
  </Node>
</Connections>`;

    const result = parseMremoteng(xml);
    expect(result.totalFolders).toBe(2);
    expect(result.totalConnections).toBe(1);
    expect(result.folders[0].name).toBe('Level1');
    expect(result.folders[0].children[0].name).toBe('Level2');
    expect(result.folders[0].children[0].connections[0].name).toBe('Deep Server');
  });

  it('uses default port when port is missing', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" FullFileEncryption="false" Protected="">
  <Node Name="No Port SSH" Type="Connection" Protocol="SSH2" Hostname="1.2.3.4" Username="u" Password="" />
  <Node Name="No Port RDP" Type="Connection" Protocol="RDP" Hostname="5.6.7.8" Username="u" Password="" />
</Connections>`;

    const result = parseMremoteng(xml);
    expect(result.connections[0].port).toBe(22);
    expect(result.connections[1].port).toBe(3389);
  });
});

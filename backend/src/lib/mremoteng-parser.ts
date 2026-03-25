/**
 * mRemoteNG confCons.xml parser
 *
 * Handles:
 *  - Unencrypted XML files
 *  - FullFileEncryption="true" (entire body encrypted)
 *  - Per-field encrypted passwords (individual Password attributes)
 *
 * mRemoteNG encryption scheme:
 *  - PBKDF2-SHA1 key derivation (NOT SHA256)
 *  - AES-128-GCM (16-byte key) by default, but mRemoteNG ≥1.77 can use AES-256-GCM
 *    depending on BlockCipherMode. We handle the common GCM case.
 *  - Encrypted blob (base64-decoded): [salt 16] [nonce 16] [ciphertext ...] [tag 16]
 */

import { XMLParser } from 'fast-xml-parser';
import { pbkdf2Sync, createDecipheriv } from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ParsedConnection {
  name: string;
  host: string;
  port: number;
  protocol: 'ssh' | 'rdp';
  username: string;
  password: string;
  domain: string;
  notes: string;
  osType: string;
  clipboardEnabled: boolean;
}

export interface ParsedFolder {
  name: string;
  children: ParsedFolder[];
  connections: ParsedConnection[];
}

export interface ParseResult {
  folders: ParsedFolder[];
  connections: ParsedConnection[]; // root-level connections
  warnings: string[];
  totalConnections: number;
  totalFolders: number;
  encrypted: boolean;
}

// ── mRemoteNG decryption ───────────────────────────────────────────────────

function mremotengDecrypt(base64Blob: string, masterPassword: string, kdfIterations: number): string {
  const raw = Buffer.from(base64Blob, 'base64');
  // mRemoteNG format (BouncyCastle AES-256-GCM):
  //   [salt 16] [nonce 16] [ciphertext N] [GCM auth-tag 16]
  // Key: PBKDF2-SHA1, 32 bytes (AES-256)
  // Salt is also used as GCM AAD (Associated Authenticated Data)
  if (raw.length < 48) return ''; // too short to be encrypted

  const salt = raw.subarray(0, 16);
  const nonce = raw.subarray(16, 32);
  const ciphertextWithTag = raw.subarray(32);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

  const key = pbkdf2Sync(masterPassword, salt, kdfIterations, 32, 'sha1');

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(salt);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// ── Detection helpers ──────────────────────────────────────────────────────

function looksLikeBase64(s: string): boolean {
  if (!s || s.length < 20) return false;
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

function findFirstEncryptedPassword(nodes: any[]): string | null {
  for (const n of nodes) {
    const pw = n['@_Password'] || '';
    if (pw && looksLikeBase64(pw)) return pw;
    const children = n.Node ? (Array.isArray(n.Node) ? n.Node : [n.Node]) : [];
    const found = findFirstEncryptedPassword(children);
    if (found) return found;
  }
  return null;
}

function inferOsType(icon: string | undefined, protocol: 'ssh' | 'rdp'): string {
  if (icon) {
    const lower = icon.toLowerCase();
    if (lower.includes('windows') || lower === 'mremoteng') return 'windows';
    if (lower.includes('linux') || lower.includes('ubuntu') || lower.includes('debian') || lower.includes('redhat') || lower.includes('tux')) return 'linux';
  }
  return protocol === 'rdp' ? 'windows' : 'linux';
}

function mapProtocol(proto: string): 'ssh' | 'rdp' | null {
  const upper = (proto || '').toUpperCase();
  if (upper === 'RDP') return 'rdp';
  if (upper === 'SSH2' || upper === 'SSH1') return 'ssh';
  return null;
}

// ── XML parsing ────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'Node',
  parseAttributeValue: false, // keep everything as strings
  removeNSPrefix: true, // handle xmlns namespaces like mrng:Connections
});

function walkNodes(
  nodes: any[],
  masterPassword: string | undefined,
  kdfIterations: number,
  warnings: string[],
  counters: { connections: number; folders: number },
): { folders: ParsedFolder[]; connections: ParsedConnection[] } {
  const folders: ParsedFolder[] = [];
  const connections: ParsedConnection[] = [];

  for (const node of nodes) {
    const type = node['@_Type'];
    const name = node['@_Name'] || 'Unnamed';

    if (type === 'Container') {
      counters.folders++;
      const children = node.Node ? (Array.isArray(node.Node) ? node.Node : [node.Node]) : [];
      const result = walkNodes(children, masterPassword, kdfIterations, warnings, counters);
      folders.push({
        name,
        children: result.folders,
        connections: result.connections,
      });
    } else if (type === 'Connection') {
      const rawProtocol = node['@_Protocol'] || '';
      const protocol = mapProtocol(rawProtocol);
      if (!protocol) {
        warnings.push(`Skipped "${name}": unsupported protocol "${rawProtocol}"`);
        continue;
      }

      let password = '';
      const rawPassword = node['@_Password'] || '';
      if (rawPassword && masterPassword && looksLikeBase64(rawPassword)) {
        try {
          password = mremotengDecrypt(rawPassword, masterPassword, kdfIterations);
        } catch {
          warnings.push(`Could not decrypt password for "${name}"`);
        }
      } else if (rawPassword && !looksLikeBase64(rawPassword)) {
        password = rawPassword;
      }

      const portStr = node['@_Port'] || '';
      const port = parseInt(portStr, 10) || (protocol === 'rdp' ? 3389 : 22);

      counters.connections++;
      connections.push({
        name,
        host: node['@_Hostname'] || '',
        port,
        protocol,
        username: node['@_Username'] || '',
        password,
        domain: node['@_Domain'] || '',
        notes: node['@_Descr'] || node['@_Description'] || '',
        osType: inferOsType(node['@_Icon'], protocol),
        clipboardEnabled: protocol === 'rdp' ? (node['@_RedirectClipboard'] || 'true').toLowerCase() === 'true' : true,
      });
    }
  }

  return { folders, connections };
}

export function parseMremoteng(
  xmlContent: string,
  masterPassword?: string,
): ParseResult {
  const warnings: string[] = [];

  const parsed = xmlParser.parse(xmlContent);
  const root = parsed.Connections || parsed.mrng || parsed;

  // Check full-file encryption
  const fullEncryption = (root['@_FullFileEncryption'] || '').toLowerCase() === 'true';
  const protectedAttr = root['@_Protected'] || '';
  const kdfIterations = parseInt(root['@_KdfIterations'] || '10000', 10) || 10000;

  if (fullEncryption) {
    if (!masterPassword) {
      return {
        folders: [],
        connections: [],
        warnings: [],
        totalConnections: 0,
        totalFolders: 0,
        encrypted: true,
      };
    }

    // The encrypted body is the text content of the root element
    const encryptedBody = root['#text'] || '';
    if (!encryptedBody) {
      throw new Error('FullFileEncryption is true but no encrypted content found');
    }

    let decryptedXml: string;
    try {
      decryptedXml = mremotengDecrypt(encryptedBody, masterPassword, kdfIterations);
    } catch {
      throw new Error('Failed to decrypt file — wrong master password?');
    }

    // Re-parse the decrypted XML
    return parseMremoteng(decryptedXml, masterPassword);
  }

  // Check for per-field encryption
  const nodes = root.Node ? (Array.isArray(root.Node) ? root.Node : [root.Node]) : [];

  // Detect if passwords are encrypted by checking if any actual password
  // fields contain base64-encoded encrypted blobs. The Protected attribute
  // is just a config hash and does NOT indicate password encryption.
  let hasEncryptedPasswords = false;
  const checkEncrypted = (nodeList: any[]): boolean => {
    for (const n of nodeList) {
      const pw = n['@_Password'] || '';
      if (pw && looksLikeBase64(pw)) return true;
      const children = n.Node ? (Array.isArray(n.Node) ? n.Node : [n.Node]) : [];
      if (checkEncrypted(children)) return true;
    }
    return false;
  };
  hasEncryptedPasswords = checkEncrypted(nodes);

  // mRemoteNG always encrypts passwords, even without a user-set master password.
  // The default password is "mR3m". Try it first before prompting the user.
  const DEFAULT_PASSWORD = 'mR3m';
  let effectivePassword = masterPassword;

  if (hasEncryptedPasswords && !masterPassword) {
    // Try the default password on the first encrypted password we find
    const firstEncrypted = findFirstEncryptedPassword(nodes);
    if (firstEncrypted) {
      try {
        mremotengDecrypt(firstEncrypted, DEFAULT_PASSWORD, kdfIterations);
        // Default password works — use it
        effectivePassword = DEFAULT_PASSWORD;
      } catch {
        // Default password failed — user has a custom master password
        return {
          folders: [],
          connections: [],
          warnings: [],
          totalConnections: 0,
          totalFolders: 0,
          encrypted: true,
        };
      }
    }
  }

  const counters = { connections: 0, folders: 0 };
  const result = walkNodes(nodes, effectivePassword, kdfIterations, warnings, counters);

  return {
    ...result,
    warnings,
    totalConnections: counters.connections,
    totalFolders: counters.folders,
    encrypted: false,
  };
}

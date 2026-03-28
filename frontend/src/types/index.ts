export interface User {
  id: string;
  username: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  sshProfileId?: string | null;
  rdpProfileId?: string | null;
  userId: string;
  createdAt: string;
}

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'ssh' | 'rdp';
  username: string;
  domain?: string | null;
  osType?: string | null;
  notes?: string | null;
  clipboardEnabled?: boolean;
  scrollbackLines?: number | null;
  folderId?: string | null;
  profileId?: string | null;
  privateKey?: string | null;
  createdAt: string;
}

export interface ConnectionFormValues {
  name: string;
  host: string;
  port: number;
  protocol: 'ssh' | 'rdp';
  username: string;
  password?: string;
  privateKey?: string;
  domain?: string;
  osType?: string;
  notes?: string;
  clipboardEnabled?: boolean;
  scrollbackLines?: number | null;
  folderId?: string | null;
  profileId?: string | null;
}

export interface Profile {
  id: string;
  name: string;
  protocol: 'ssh' | 'rdp';
  username?: string | null;
  domain?: string | null;
  clipboardEnabled?: boolean | null;
  scrollbackLines?: number | null;
  hasPassword?: boolean;
  hasPrivateKey?: boolean;
  createdAt: string;
}

export interface ProfileFormValues {
  name: string;
  protocol: 'ssh' | 'rdp';
  username?: string;
  password?: string;
  privateKey?: string;
  domain?: string;
  clipboardEnabled?: boolean;
  scrollbackLines?: number | null;
}

export interface Session {
  /** Unique ID for this open tab */
  id: string;
  connection: Connection;
  mode?: 'shell' | 'sftp';
}

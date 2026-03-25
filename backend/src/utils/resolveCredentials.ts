import { decrypt } from './encryption';

interface ProfileData {
  username: string | null;
  encryptedPassword: string | null;
  privateKey: string | null;
  domain: string | null;
  clipboardEnabled: boolean | null;
}

interface FolderWithProfiles {
  id: string;
  parentId: string | null;
  sshProfileId: string | null;
  sshProfile: ProfileData | null;
  rdpProfileId: string | null;
  rdpProfile: ProfileData | null;
}

interface ConnectionWithProfile {
  username: string;
  encryptedPassword: string | null;
  privateKey: string | null;
  domain: string | null;
  clipboardEnabled: boolean;
  protocol: string;
  folderId: string | null;
  profile: ProfileData | null;
  folder?: FolderWithProfiles | null;
}

export interface ResolvedCredentials {
  username: string;
  password: string;
  privateKey: string | null;
  domain: string;
  clipboardEnabled: boolean;
}

/**
 * Walk up the folder tree to find an inherited profile for the given protocol.
 * Returns the first matching profile found, or null.
 */
export function resolveInheritedProfile(
  folderId: string | null,
  protocol: string,
  allFolders: FolderWithProfiles[],
): ProfileData | null {
  const folderMap = new Map(allFolders.map((f) => [f.id, f]));
  let currentId = folderId;

  while (currentId) {
    const folder = folderMap.get(currentId);
    if (!folder) break;

    if (protocol === 'ssh' && folder.sshProfile) {
      return folder.sshProfile;
    }
    if (protocol === 'rdp' && folder.rdpProfile) {
      return folder.rdpProfile;
    }

    currentId = folder.parentId;
  }

  return null;
}

export function resolveCredentials(
  connection: ConnectionWithProfile,
  allFolders?: FolderWithProfiles[],
): ResolvedCredentials {
  // Priority: connection direct > connection's profile > inherited folder profile
  let profile = connection.profile;

  if (!profile && allFolders) {
    profile = resolveInheritedProfile(connection.folderId, connection.protocol, allFolders);
  }

  return {
    username: connection.username || profile?.username || '',
    password: connection.encryptedPassword
      ? decrypt(connection.encryptedPassword)
      : profile?.encryptedPassword
        ? decrypt(profile.encryptedPassword)
        : '',
    privateKey: connection.privateKey
      ? decrypt(connection.privateKey)
      : profile?.privateKey
        ? decrypt(profile.privateKey)
        : null,
    domain: connection.domain || profile?.domain || '',
    clipboardEnabled: connection.clipboardEnabled ?? profile?.clipboardEnabled ?? true,
  };
}

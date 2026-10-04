export interface ServerConfig {
  port: number;
  workspacePath: string;
  jwtSecret: string;
  databasePath: string;
  mode: "host" | "remote";
  hostUrl?: string;
  inviteToken?: string;
  userName?: string;
  /** Admin secret for this server (host). Auto-generated on first run. */
  adminToken?: string;
  /** Interface to bind. Default "127.0.0.1" (secure). "0.0.0.0" = LAN mode (auth still required for non-local). */
  bindAddress?: string;
  /** REMOTE mode: member access token obtained by redeeming an invite link. */
  memberToken?: string;
  /** REMOTE mode: member display name / permissions (cached for UI). */
  memberName?: string;
  memberPermissions?: string;
}

export interface AuthIdentity {
  type: "local" | "admin" | "member";
  userId: string;
  userName: string;
  permissions: string[];
}

export interface FileMetadata {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: Date;
  createdAt: Date;
}

export interface LockInfo {
  id: string;
  filePath: string;
  userId: string;
  userName: string;
  reason: string;
  acquiredAt: Date;
  expiresAt: Date;
}

export interface AcquireLockParams {
  workspaceId: string;
  filePath: string;
  userId: string;
  userName?: string;
  sessionId: string;
  reason?: string;
}

export interface ChangeLogEntry {
  id: string;
  workspaceId: string;
  filePath: string;
  userId: string;
  userName?: string;
  action: "create" | "read" | "update" | "delete" | "move" | "lock" | "unlock" | "rollback";
  oldContentHash?: string;
  newContentHash?: string;
  oldPath?: string;
  newPath?: string;
  metadata?: string;
  timestamp: Date;
}

export interface SnapshotInfo {
  id: string;
  workspaceId: string;
  filePath: string;
  contentHash: string;
  size: number;
  changeId?: string;
  createdBy?: string;
  createdAt: Date;
}

export interface TeamMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  permissions: string;
  invitedAt: Date;
  acceptedAt?: Date;
  email?: string;
  name?: string;
}

export interface InviteLink {
  id: string;
  workspaceId: string;
  token: string;
  email?: string;
  permissions: string;
  expiresAt?: Date;
  maxUses?: number;
  useCount: number;
  createdBy: string;
  createdAt: Date;
  revokedAt?: Date;
}

export interface ActiveSession {
  id: string;
  userId: string;
  workspaceId: string;
  mcpSessionId?: string;
  connectedAt: Date;
  lastHeartbeat: Date;
  userAgent?: string;
}

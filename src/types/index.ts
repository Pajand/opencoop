export interface ServerConfig {
  port: number;
  workspacePath: string;
  jwtSecret: string;
  databasePath: string;
  mode: "host" | "remote";
  hostUrl?: string;
  inviteToken?: string;
  userName?: string;
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
  sessionId: string;
  reason?: string;
}

export interface ChangeLogEntry {
  id: string;
  workspaceId: string;
  filePath: string;
  userId: string;
  userName?: string;
  action: "create" | "read" | "update" | "delete" | "move" | "lock" | "unlock";
  oldContentHash?: string;
  newContentHash?: string;
  oldPath?: string;
  newPath?: string;
  metadata?: string;
  timestamp: Date;
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

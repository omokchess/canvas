export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  room_code: string;
  user_id: string;
  tool: "pen" | "eraser";
  color: string;
  size: number;
  points: Point[];
  created_at?: string;
  is_deleted?: boolean;
}

export interface RoomInfo {
  roomCode: string;
  title: string;
  createdAt: string;
  dbMode: "supabase" | "fallback";
}

export interface PeerProfile {
  peer_id: string;
  nickname: string;
  last_seen?: string;
}

export type MessageType = "STROKE_ADD" | "CLEAR_CANVAS" | "UNDO" | "REDO";

export interface DrawingMessage {
  type: MessageType;
  roomCode: string;
  strokeId?: string; // used for undo
  stroke?: Stroke;   // used for add / redo
}

export interface SyncStatus {
  state: "synced" | "saving" | "failed" | "retrying";
  pendingCount: number;
}

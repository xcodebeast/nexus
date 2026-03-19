export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RtcConfigurationPayload {
  iceServers: IceServerConfig[];
  iceCandidatePoolSize?: number;
}

export interface RoomUser {
  id: string;
  username: string;
  isMuted: boolean;
  isSpeaking: boolean;
  connectedAt: number;
}

export interface SessionUser {
  id: string;
  username: string;
}

export interface SessionPayload {
  user: SessionUser;
  roomId: string;
  rtcConfiguration: RtcConfigurationPayload;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ErrorPayload {
  message: string;
}

export type WebRtcSignal =
  | {
      type: "offer";
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: "answer";
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      candidate: RTCIceCandidateInit;
    };

export type ClientEvent =
  | {
      type: "presence:update";
      isMuted: boolean;
      isSpeaking: boolean;
    }
  | {
      type: "signal";
      targetUserId: string;
      signal: WebRtcSignal;
    };

export type ServerEvent =
  | {
      type: "room:snapshot";
      selfUserId: string;
      roomId: string;
      users: RoomUser[];
      rtcConfiguration: RtcConfigurationPayload;
    }
  | {
      type: "room:user-joined";
      user: RoomUser;
    }
  | {
      type: "room:user-left";
      userId: string;
    }
  | {
      type: "room:user-updated";
      user: RoomUser;
    }
  | {
      type: "signal";
      fromUserId: string;
      signal: WebRtcSignal;
    }
  | {
      type: "error";
      message: string;
    };

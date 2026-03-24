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
  isAfk: boolean;
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

export type SignalChannel = "audio" | "screen";

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
      isAfk: boolean;
    }
  | {
      type: "screen-share:start";
    }
  | {
      type: "screen-share:stop";
    }
  | {
      type: "signal";
      channel: SignalChannel;
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
      activeScreenShareUserId: string | null;
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
      type: "room:screen-share-updated";
      activeScreenShareUserId: string | null;
    }
  | {
      type: "signal";
      channel: SignalChannel;
      fromUserId: string;
      signal: WebRtcSignal;
    }
  | {
      type: "error";
      message: string;
    };

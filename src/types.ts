export type EventType = 'NORMAL' | 'WARNING' | 'ACCIDENT';

export interface SensorData {
  timestamp: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  heading: number;
  lat: number;
  lng: number;
  vehicleId: string;
}

export interface V2XMessage {
  id: string;
  senderId: string;
  timestamp: number;
  type: 'HEARTBEAT' | 'COLLISION_ALERT' | 'DISTANT_WARNING';
  eventType: EventType;
  data: SensorData;
  hash: string;
  signature?: string;
  publicKey?: string;
  isVerified?: boolean;
  warningDistance?: number;
}

export interface Block {
  index: number;
  timestamp: number;
  messages: V2XMessage[];
  previousHash: string;
  hash: string;
  nonce: number;
  isAccidentBlock?: boolean;
}

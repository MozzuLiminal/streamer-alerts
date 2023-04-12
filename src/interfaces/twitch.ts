export interface Subscription {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: Condition;
  created_at: string;
  transport: Transport;
  cost: number;
}

export interface Condition {
  broadcaster_user_id: string;
}

export interface Transport {
  method: string;
  session_id: string;
  connected_at: string;
}

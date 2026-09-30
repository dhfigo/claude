export type OrderStatus = "pending" | "paid" | "failed" | "canceled" | "refunded";

export interface OrderRow {
  id: string;
  user_id: string;
  amount: number;
  credits: number;
  status: OrderStatus;
  payment_key: string | null;
  created_at: string;
}

export interface PackRow {
  id: string;
  name: string;
  credits: number;
  price_krw: number;
}

export type CompleteResult = "paid" | "already_paid" | "rejected" | "amount_mismatch" | "not_found";

/** 영속화 경계. 실제 구현은 service_role 클라이언트, 테스트에서는 가짜. */
export interface PaymentPorts {
  getOrder(orderId: string): Promise<OrderRow | null>;
  getActivePack(packId: string): Promise<PackRow | null>;
  insertOrder(args: { userId: string; pack: PackRow }): Promise<{ id: string } | null>;
  completeOrder(args: { orderId: string; paymentKey: string; amount: number; approvedAt: string }): Promise<CompleteResult>;
  cancelOrder(orderId: string, paymentKey: string): Promise<string>;
  failOrder(orderId: string): Promise<boolean>;
  recordEvent(args: { paymentKey: string; orderId: string | null; tossStatus: string; source: "webhook" | "confirm" | "reconcile" }): Promise<void>;
  listStalePending(olderThanMinutes: number, limit: number): Promise<OrderRow[]>;
}

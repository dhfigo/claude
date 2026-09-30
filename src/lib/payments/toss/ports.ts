import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CompleteResult, OrderRow, PackRow, PaymentPorts } from "./types";

const OrderSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  amount: z.number(),
  credits: z.number(),
  status: z.enum(["pending", "paid", "failed", "canceled", "refunded"]),
  payment_key: z.string().nullable(),
  created_at: z.string(),
});
const ORDER_COLUMNS = "id, user_id, amount, credits, status, payment_key, created_at";

const PackSchema = z.object({ id: z.string(), name: z.string(), credits: z.number(), price_krw: z.number() });
const CompleteSchema = z.enum(["paid", "already_paid", "rejected", "amount_mismatch", "not_found"]);

// 오류 객체에는 결제 정보가 섞일 수 있어 원문을 싣지 않고 작업 이름만 남긴다.
function fail(op: string): never {
  throw new Error(`payment_port_failed:${op}`);
}

export function supabasePaymentPorts(admin: SupabaseClient): PaymentPorts {
  return {
    async getOrder(orderId): Promise<OrderRow | null> {
      const { data, error } = await admin.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle();
      if (error) fail("getOrder");
      return data ? OrderSchema.parse(data) : null;
    },

    async getActivePack(packId): Promise<PackRow | null> {
      const { data, error } = await admin
        .from("credit_packs")
        .select("id, name, credits, price_krw")
        .eq("id", packId)
        .eq("active", true)
        .maybeSingle();
      if (error) fail("getActivePack");
      return data ? PackSchema.parse(data) : null;
    },

    async insertOrder({ userId, pack }) {
      const { data, error } = await admin
        .from("orders")
        .insert({ user_id: userId, pack_id: pack.id, pack_name: pack.name, amount: pack.price_krw, credits: pack.credits })
        .select("id")
        .single();
      return error || !data ? null : { id: String(data.id) };
    },

    async completeOrder({ orderId, paymentKey, amount, approvedAt }): Promise<CompleteResult> {
      const { data, error } = await admin.rpc("complete_order", {
        p_order: orderId,
        p_payment_key: paymentKey,
        p_amount: amount,
        p_approved_at: approvedAt,
      });
      if (error) fail("completeOrder");
      return CompleteSchema.parse(data);
    },

    async cancelOrder(orderId, paymentKey) {
      const { data, error } = await admin.rpc("cancel_order", { p_order: orderId, p_payment_key: paymentKey });
      if (error) fail("cancelOrder");
      return String(data);
    },

    async failOrder(orderId) {
      const { data, error } = await admin.rpc("fail_order", { p_order: orderId });
      if (error) fail("failOrder");
      return data === true;
    },

    async recordEvent({ paymentKey, orderId, tossStatus, source }) {
      await admin
        .from("payment_events")
        .upsert(
          { payment_key: paymentKey, order_id: orderId, toss_status: tossStatus, source },
          { onConflict: "payment_key,toss_status,source", ignoreDuplicates: true },
        );
    },

    async listStalePending(olderThanMinutes, limit) {
      const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
      const { data, error } = await admin
        .from("orders")
        .select(ORDER_COLUMNS)
        .eq("status", "pending")
        .lt("created_at", cutoff)
        .order("created_at")
        .limit(limit);
      if (error) fail("listStalePending");
      return (data ?? []).map((row) => OrderSchema.parse(row));
    },
  };
}

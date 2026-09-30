import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTossApi } from "./toss/client";
import type { PaymentDeps } from "./toss/orders";
import { supabasePaymentPorts } from "./toss/ports";

export function createPaymentDeps(): PaymentDeps {
  const secretKey = z.string().min(1).parse(process.env.TOSS_SECRET_KEY);
  return { ports: supabasePaymentPorts(createAdminClient()), toss: createTossApi({ secretKey }) };
}

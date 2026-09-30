import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeletionPorts } from "./delete";

export const ORIGINALS_BUCKET = "originals";

export function supabaseDeletionPorts(admin: SupabaseClient): DeletionPorts {
  return {
    removeObject: async (path) => {
      const { error } = await admin.storage.from(ORIGINALS_BUCKET).remove([path]);
      return !error;
    },
    markDeleted: async (id) => {
      const { error } = await admin
        .from("documents")
        .update({ status: "deleted", deleted_at: new Date().toISOString() })
        .eq("id", id);
      return !error;
    },
    scheduleNow: async (id) => {
      const { error } = await admin
        .from("documents")
        .update({ expires_at: new Date().toISOString() })
        .eq("id", id)
        .is("deleted_at", null);
      return !error;
    },
  };
}

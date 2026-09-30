"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function StatusPoller() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}

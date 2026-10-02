"use client";
// Frys en levererad rapport som inte har någon ögonblicksbild än (prototypens rap.snapshot). Körs en gång per rapport
// när sidan visar den – som prototypen gör direkt efter leveransen. Kommandot är tyst och hoppar över frysta rapporter.
import { useEffect, useRef } from "react";
import { useCommand } from "@/shell/backend";
import { reportSnapshot } from "../api";

export function useLazySnapshot(reportId: string | null, needed: boolean) {
  const snapshot = useCommand(reportSnapshot);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!reportId || !needed || done.current === reportId) return;
    done.current = reportId;
    void snapshot.run({ reportIds: [reportId] }).catch(() => undefined);
  }, [reportId, needed, snapshot]);
}

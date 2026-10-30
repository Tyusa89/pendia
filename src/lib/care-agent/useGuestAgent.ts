// Client hooks for the guest (judge) Ask path. Same shape as the member hooks, but it calls the unauthenticated guest functions and
// never sends a family id. The conversation lives only in component memory: nothing is written to browser storage.
import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AGENT_LIMITS, type AskResult } from "./contract";
import { askGuestAgentFn, getGuestAgentStatus } from "./guest.functions";
import type { Turn } from "./useCareAgent";

export function useGuestAgentStatus() {
  const q = useQuery<{ state: "available" | "not_enabled" }>({
    queryKey: ["guest-agent-status"],
    queryFn: async () => (await getGuestAgentStatus()) as { state: "available" | "not_enabled" },
    retry: 1,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return {
    loading: q.isPending,
    available: !q.isError && q.data?.state === "available",
    failed: q.isError,
    retry: () => void q.refetch(),
  };
}

export function useGuestAgentConversation() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const seq = useRef(0);
  const ask = useCallback(
    async (question: string) => {
      const mine = ++seq.current;
      setPending(question);
      const recentTurns = turns
        .filter(
          (t): t is Turn & { result: Extract<AskResult, { ok: true }> } =>
            t.result.ok && !t.result.answer.refusal,
        )
        .slice(-Math.floor(AGENT_LIMITS.recentTurnsMax / 2))
        .flatMap((t) => [
          { role: "user" as const, text: t.question.slice(0, AGENT_LIMITS.recentTurnMax) },
          {
            role: "assistant" as const,
            text: t.result.answer.answer.slice(0, AGENT_LIMITS.recentTurnMax),
          },
        ]);
      let result: AskResult;
      try {
        result = (await askGuestAgentFn({ data: { question, recentTurns } })) as AskResult;
      } catch {
        result = { ok: false, code: "not_enabled", language: "en" };
      }
      if (seq.current !== mine) return;
      setPending(null);
      setTurns((t) => [...t, { question, result }]);
    },
    [turns],
  );
  const cancel = useCallback(() => {
    seq.current += 1;
    setPending(null);
  }, []);
  return { turns, pending, ask, cancel };
}

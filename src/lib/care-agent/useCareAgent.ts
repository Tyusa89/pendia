// Client hooks for Ask Pendia. Availability is a server-function call (bounded retries; a failed CHECK is `lookup_failed`, never a
// denial). The conversation lives only in component memory: nothing is written to browser storage, and it is gone when the page
// is left. The server never stores a question or an answer.
import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AGENT_LIMITS, type AskResult, type CareAgentStatus } from "./contract";
import { askCareAgentFn, getCareAgentStatus } from "./care-agent.functions";
import { isJudgeDemo } from "@/lib/judge-demo";

const STATUS_RETRY_DELAYS_MS = [1000, 3000];

export function useCareAgentStatus(familyId: string | undefined) {
  const q = useQuery<CareAgentStatus>({
    queryKey: ["care-agent-status", familyId],
    enabled: !!familyId,
    queryFn: async () => {
      if (isJudgeDemo()) return { state: "not_enabled" };
      if (!familyId) return { state: "not_member" };
      return (await getCareAgentStatus({ data: { familyId } })) as CareAgentStatus;
    },
    retry: STATUS_RETRY_DELAYS_MS.length,
    retryDelay: (attempt) =>
      STATUS_RETRY_DELAYS_MS[Math.min(attempt, STATUS_RETRY_DELAYS_MS.length - 1)]!,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return {
    loading: !!familyId && (q.isPending || (q.isFetching && !q.data)),
    status: q.data ?? null,
    failed: q.isError || q.data?.state === "lookup_failed",
    retry: () => void q.refetch(),
  };
}

export interface Turn {
  question: string;
  result: AskResult;
}

export function useCareAgentConversation(familyId: string | undefined) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const seq = useRef(0);

  const ask = useCallback(
    async (question: string) => {
      if (!familyId || isJudgeDemo()) return;
      const mine = ++seq.current;
      setPending(question);
      // Only answered turns that carry no refusal are re-sent as context; only the last few, each capped.
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
        result = (await askCareAgentFn({ data: { familyId, question, recentTurns } })) as AskResult;
      } catch {
        result = { ok: false, code: "provider_error", language: "en" };
      }
      if (seq.current !== mine) return; // cancelled or superseded
      setPending(null);
      setTurns((t) => [...t, { question, result }]);
    },
    [familyId, turns],
  );

  const cancel = useCallback(() => {
    seq.current += 1;
    setPending(null);
  }, []);

  return { turns, pending, ask, cancel };
}

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/AppShell";
import { familyKey } from "@/hooks/use-family";
import {
  CODE_DID_NOT_WORK,
  formatFamilyCode,
  isCompleteFamilyCode,
  joinErrorMessage,
} from "@/lib/join-family";
import { familyService, joinService } from "@/services";

export const MY_JOIN_REQUESTS_KEY = ["join-requests", "mine"] as const;

/** Onboarding: "I have a family code". Shows nothing about the family; the answer is only "waiting for approval". */
export function JoinFamilyForm() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => joinService.request(code, name.trim()),
    onSuccess: (id) => {
      if (id === null) {
        setProblem(CODE_DID_NOT_WORK);
        return;
      }
      setProblem(null);
      setCode("");
      void qc.invalidateQueries({ queryKey: MY_JOIN_REQUESTS_KEY });
    },
    onError: (e) => setProblem(joinErrorMessage((e as Error).message)),
  });
  const ready = isCompleteFamilyCode(code) && name.trim().length > 0 && !send.isPending;
  return (
    <Panel className="space-y-4">
      <h2 className="text-xl font-semibold">Join an existing family</h2>
      <p className="text-muted-foreground">
        Ask the family organizer for their family code. It only tells Pendia where to send your
        request. The organizer decides whether to let you in.
      </p>
      <div className="space-y-2">
        <Label htmlFor="join-code">Family code</Label>
        <Input
          id="join-code"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => {
            setCode(formatFamilyCode(e.target.value));
            setProblem(null);
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="join-name">Your name</Label>
        <Input
          id="join-name"
          placeholder="Elena"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {problem && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {problem}
        </p>
      )}
      <Button className="w-full" disabled={!ready} onClick={() => send.mutate()}>
        Send request
      </Button>
    </Panel>
  );
}

/**
 * Shown instead of the onboarding choices while a request is open (or after an answer). Polls for the answer; once approved the new
 * membership becomes the active family and the app opens it.
 */
export function JoinRequestStatus({ onStartOver }: { onStartOver: () => void }) {
  const qc = useQueryClient();
  const { data: requests = [] } = useQuery({
    queryKey: MY_JOIN_REQUESTS_KEY,
    queryFn: () => joinService.myRequests(),
    refetchInterval: 10_000,
  });
  const latest = requests[0];
  const approvedSeen = useRef(false);
  useEffect(() => {
    if (latest?.status !== "approved" || approvedSeen.current) return;
    approvedSeen.current = true;
    void (async () => {
      const families = await familyService.listMyFamilies();
      if (families[0]) await familyService.setActiveFamily(families[0].id);
      await qc.invalidateQueries({ queryKey: familyKey });
      await qc.invalidateQueries({ queryKey: ["my-families"] });
    })();
  }, [latest?.status, qc]);
  const cancel = useMutation({
    mutationFn: (id: string) => joinService.cancel(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MY_JOIN_REQUESTS_KEY });
      onStartOver();
    },
    onError: (e) => toast.error(joinErrorMessage((e as Error).message)),
  });
  if (!latest) return null;
  if (latest.status === "pending")
    return (
      <Panel className="space-y-3">
        <h2 className="text-xl font-semibold">Pending approval</h2>
        <p role="status" className="text-muted-foreground">
          Your request was sent. The family organizer has to approve it before you can see anything.
          This page updates by itself.
        </p>
        <Button
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(latest.request_id)}
        >
          Cancel request
        </Button>
      </Panel>
    );
  if (latest.status === "approved")
    return (
      <Panel>
        <h2 className="text-xl font-semibold">Approved</h2>
        <p role="status" className="text-muted-foreground">
          Opening your family…
        </p>
      </Panel>
    );
  if (latest.status === "declined")
    return (
      <Panel className="space-y-3">
        <h2 className="text-xl font-semibold">Request not approved</h2>
        <p role="status" className="text-muted-foreground">
          The organizer did not approve this request. You can ask them about it, or try again later.
        </p>
        <Button variant="outline" onClick={onStartOver}>
          Back
        </Button>
      </Panel>
    );
  return null;
}

import { useQuery } from "@tanstack/react-query";
import { familyService } from "@/services";

export const familyKey = ["my-family"] as const;

export function useFamily() {
  return useQuery({ queryKey: familyKey, queryFn: () => familyService.getMyFamily() });
}

export function useMembers(familyId?: string) {
  return useQuery({
    queryKey: ["members", familyId],
    queryFn: () => familyService.listMembers(familyId!),
    enabled: !!familyId,
  });
}

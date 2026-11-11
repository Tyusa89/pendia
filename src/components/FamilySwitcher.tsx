import { useQuery, useQueryClient } from "@tanstack/react-query";
import { familyService } from "@/services";

/** Header family name; becomes a dropdown when the user belongs to more than one family. */
export function FamilySwitcher({ activeId, activeName }: { activeId: string; activeName: string }) {
  const qc = useQueryClient();
  const { data: families = [] } = useQuery({ queryKey: ["my-families"], queryFn: () => familyService.listMyFamilies() });

  if (families.length < 2) {
    return <span className="inline-flex min-h-11 max-w-[9rem] items-center rounded-full border-[1.5px] border-input bg-card px-3.5 font-brand text-sm font-semibold text-foreground md:max-w-[14rem]"><span className="truncate">{activeName}</span></span>;
  }

  async function onChange(id: string) {
    if (id === activeId) return;
    await familyService.setActiveFamily(id);
    // Drop every cached family-scoped result so nothing from the previous family can render.
    await qc.cancelQueries();
    await qc.resetQueries();
  }

  return (
    <label className="flex min-w-0 items-center">
      <span className="sr-only">Active family</span>
      <select
        data-testid="family-switcher"
        value={activeId}
        onChange={(e) => void onChange(e.target.value)}
        className="h-11 max-w-[9rem] truncate rounded-full border-[1.5px] border-input bg-card px-3.5 font-brand text-sm font-semibold text-foreground md:max-w-[14rem]"
      >
        {families.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
    </label>
  );
}

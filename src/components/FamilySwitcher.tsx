import { useQuery, useQueryClient } from "@tanstack/react-query";
import { familyService } from "@/services";

/** Header family name; becomes a dropdown when the user belongs to more than one family. */
export function FamilySwitcher({ activeId, activeName }: { activeId: string; activeName: string }) {
  const qc = useQueryClient();
  const { data: families = [] } = useQuery({ queryKey: ["my-families"], queryFn: () => familyService.listMyFamilies() });

  if (families.length < 2) {
    return <span className="hidden max-w-[10rem] truncate text-sm text-muted-foreground md:inline">{activeName}</span>;
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
        className="h-11 max-w-[9rem] truncate rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:max-w-[14rem]"
      >
        {families.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
    </label>
  );
}

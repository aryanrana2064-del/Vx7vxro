import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { Select } from "./ui";

export function useSites() {
  return useQuery({ queryKey: ["sites"], queryFn: () => apiGet<{ sites: { id: string; name: string; trackingId: string }[] }>("/v1/sites") });
}

export function SiteSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const sites = useSites();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Select website">
      <option value="">Select website…</option>
      {sites.data?.sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}

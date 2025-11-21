import { Button } from "@/components/ui/button";

export default function QuickFill({
  balance,
  onSelect,
  percents = [10, 25, 50, 75, 100],
}: {
  balance?: number;
  onSelect: (v: string) => void;
  percents?: number[];
}) {
  if (balance == null) return null;
  const handle = (p: number) => {
    // For 100%, use 99.9% to account for precision/rounding issues with aggregators
    // This prevents "transfer amount exceeds balance" errors when swapping max balance
    const actualPercent = p === 100 ? 99.9 : p;
    const v = (balance * (actualPercent / 100)).toString();
    onSelect(v);
  };
  return (
    <div className="flex items-center gap-1 text-[11px]">
      {percents.map((p) => (
        <Button
          key={p}
          type="button"
          size="sm"
          variant="secondary"
          className="h-6 px-2"
          onClick={() => handle(p)}
        >
          {p}%
        </Button>
      ))}
    </div>
  );
}

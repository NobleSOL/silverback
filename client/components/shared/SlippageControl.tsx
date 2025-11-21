import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function SlippageControl({
  value,
  onChange,
  className,
  storageKey = "slippagePct",
}: {
  value?: number;
  onChange?: (pct: number) => void;
  className?: string;
  storageKey?: string;
}) {
  const [internal, setInternal] = useState<number>(() => {
    const fromLs =
      typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    const parsed = fromLs ? Number(fromLs) : NaN;
    return Number.isFinite(parsed) ? parsed : 0.5;
  });

  const pct = value ?? internal;

  useEffect(() => {
    if (value == null) {
      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, String(internal));
      }
    }
  }, [internal, storageKey, value]);

  const setPct = (n: number) => {
    const clamped = Math.max(0.01, Math.min(5, Number.isFinite(n) ? n : 0.5));
    if (onChange) onChange(clamped);
    else setInternal(clamped);
  };

  const presets = useMemo(() => [0.1, 0.5, 1], []);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center gap-1">
        {presets.map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={Math.abs(p - pct) < 1e-6 ? "default" : "secondary"}
            onClick={() => setPct(p)}
            className={cn(
              "h-7 px-2",
              Math.abs(p - pct) < 1e-6 &&
                "bg-brand text-white hover:bg-brand/90",
            )}
          >
            {p}%
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-7 w-7"
          onClick={() => setPct(pct - 0.1)}
        >
          -
        </Button>
        <input
          inputMode="decimal"
          value={pct}
          onChange={(e) => setPct(Number(e.target.value.replace(",", ".")))}
          className="h-7 w-20 rounded-md border border-border/60 bg-secondary/60 px-2 text-right text-sm outline-none"
        />
        <span className="text-sm">%</span>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-7 w-7"
          onClick={() => setPct(pct + 0.1)}
        >
          +
        </Button>
      </div>
    </div>
  );
}

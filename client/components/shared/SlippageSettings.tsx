import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import SlippageControl from "@/components/shared/SlippageControl";

export default function SlippageSettings({
  value,
  onChange,
  storageKey = "slippagePct",
  className,
  label = "Slippage",
}: {
  value?: number;
  onChange?: (pct: number) => void;
  storageKey?: string;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState<number>(() => {
    const v =
      typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0.5;
  });

  const pct = value ?? internal;

  const setPct = (n: number) => {
    if (onChange) onChange(n);
    else setInternal(n);
    if (typeof window !== "undefined")
      localStorage.setItem(storageKey, String(n));
  };

  return (
    <>
      <button
        type="button"
        className={cn("text-xs text-sky-400 hover:underline", className)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {label} {pct}%
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border/60 bg-card p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Slippage tolerance</h3>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Slippage is the difference between the current market price and
              the price when your swap executes. Volatile tokens usually require
              a larger value.
            </p>
            <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Tolerance</span>
                <SlippageControl value={pct} onChange={setPct} />
              </div>
            </div>
            <div className="mt-4 text-right">
              <button
                className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:bg-brand/90"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

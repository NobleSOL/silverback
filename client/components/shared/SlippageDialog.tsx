import React, { useEffect, useState } from "react";
import SlippageControl from "@/components/shared/SlippageControl";
import { X } from "lucide-react";

export function SlippageDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [value, setValue] = useState<number>(() => {
    const v =
      typeof window !== "undefined"
        ? localStorage.getItem("slippagePct")
        : null;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0.5;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("slippagePct", String(value));
      document.dispatchEvent(new Event("sb:slippage-updated"));
    }
  }, [value]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border/60 bg-card p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Slippage tolerance</h3>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Slippage is the difference between the current market price and the
          price when your swap executes.
        </p>
        <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Tolerance</span>
            <SlippageControl value={value} onChange={setValue} />
          </div>
        </div>
        <div className="mt-4 text-right">
          <button
            className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:bg-brand/90"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SlippagePortal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = () => setOpen(true);
    document.addEventListener("sb:open-slippage", handler as any);
    return () =>
      document.removeEventListener("sb:open-slippage", handler as any);
  }, []);
  return <SlippageDialog open={open} onClose={() => setOpen(false)} />;
}

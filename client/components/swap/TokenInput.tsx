import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import TokenLogo from "@/components/shared/TokenLogo";

export type Token = {
  symbol: string;
  name: string;
  logo?: string;
  address?: `0x${string}`;
  decimals?: number;
};

export function TokenInput({
  label,
  token,
  amount,
  onAmountChange,
  onTokenClick,
  balance,
  disabled,
  usdValue,
}: {
  label: string;
  token: Token;
  amount: string;
  onAmountChange: (v: string) => void;
  onTokenClick: () => void;
  balance?: number;
  disabled?: boolean;
  usdValue?: string;
}) {
  const formattedBalance = useMemo(() => {
    if (balance == null) return "";
    if (balance === 0) return "0";
    return balance.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [balance]);

  return (
    <div className="rounded-xl border border-border/60 bg-secondary/60 p-4 overflow-hidden">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {formattedBalance !== "" && <span>Bal: {formattedBalance}</span>}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={onTokenClick}
          className="min-w-24 sm:min-w-28 shrink-0 justify-between bg-card hover:bg-card/80 px-3"
          aria-label={`Select token for ${label}`}
        >
          <div className="flex items-center gap-2">
            <TokenLogo src={token.logo} alt={`${token.name} logo`} size={20} />
            <span className="font-semibold">{token.symbol}</span>
          </div>
          <ChevronDown className="opacity-70" />
        </Button>
        <div className="ml-auto flex-1 min-w-0 flex flex-col items-end">
          <input
            inputMode="decimal"
            pattern="^[0-9]*[.,]?[0-9]*$"
            placeholder="0.00"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value.replace(",", "."))}
            disabled={disabled}
            className={cn(
              "w-full bg-transparent text-right text-2xl sm:text-3xl font-semibold outline-none placeholder:text-muted-foreground/60",
            )}
          />
          {usdValue && (
            <span className="text-xs text-muted-foreground mt-0.5">
              {usdValue}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default TokenInput;

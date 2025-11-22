import { ExternalLink, Clock, CheckCircle2, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface Transaction {
  hash: string;
  timestamp: number;
  fromToken: {
    symbol: string;
    amount: string;
  };
  toToken: {
    symbol: string;
    amount: string;
  };
  status: "pending" | "success" | "failed";
  venue?: string;
}

interface TransactionHistoryProps {
  transactions: Transaction[];
}

export function TransactionHistory({ transactions }: TransactionHistoryProps) {
  if (transactions.length === 0) {
    return (
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-3">Recent Transactions</h2>
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Clock className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>No transactions yet</p>
          <p className="text-xs mt-1">Your swap history will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-3">Recent Transactions</h2>
      <div className="space-y-2">
        {transactions.slice(0, 5).map((tx) => (
          <div
            key={tx.hash}
            className="flex items-center justify-between rounded-lg border border-border/40 bg-secondary/40 p-3 text-sm hover:bg-secondary/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              {/* Status Icon */}
              {tx.status === "pending" && (
                <div className="h-5 w-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
              )}
              {tx.status === "success" && (
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              )}
              {tx.status === "failed" && (
                <XCircle className="h-5 w-5 text-red-400" />
              )}

              {/* Transaction Details */}
              <div>
                <div className="font-medium">
                  {tx.fromToken.amount} {tx.fromToken.symbol} → {tx.toToken.amount} {tx.toToken.symbol}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true })}</span>
                  {tx.venue && (
                    <>
                      <span>•</span>
                      <span className={tx.venue === "silverback-v2" ? "text-sky-400" : "text-purple-400"}>
                        {tx.venue === "silverback-v2" ? "Silverback" : "OpenOcean"}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Explorer Link */}
            <a
              href={`https://basescan.org/tx/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-sky-400 transition-colors"
              title="View on Basescan"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        ))}
      </div>
      {transactions.length > 5 && (
        <div className="mt-3 text-center text-xs text-muted-foreground">
          Showing 5 of {transactions.length} transactions
        </div>
      )}
    </div>
  );
}

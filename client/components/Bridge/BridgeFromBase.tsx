import React, { useState, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2, ArrowDown, ExternalLink, CheckCircle2, Clock } from 'lucide-react';
import {
  getQuote,
  getBaseBalance,
  checkApproval,
  approveToken,
  bridgeToKeeta,
  type BridgeQuote,
  type BridgeStatus,
} from '@/services/anchorBridge';
import { ANCHOR_CONFIG, type SupportedToken } from '@/config/chains';

interface BridgeFromBaseProps {
  keetaAddress?: string;
  onBridgeComplete?: () => void;
}

export function BridgeFromBase({ keetaAddress, onBridgeComplete }: BridgeFromBaseProps) {
  const { address: baseAddress, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [selectedToken, setSelectedToken] = useState<SupportedToken>('USDC');
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState('0');
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isBridging, setIsBridging] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Fetch balance when token or address changes
  useEffect(() => {
    if (baseAddress && isConnected) {
      fetchBalance();
    }
  }, [baseAddress, selectedToken, isConnected]);

  // Update quote when amount changes
  useEffect(() => {
    if (amount && parseFloat(amount) > 0) {
      updateQuote();
      checkTokenApproval();
    } else {
      setQuote(null);
      setIsApproved(false);
    }
  }, [amount, selectedToken]);

  const fetchBalance = async () => {
    if (!baseAddress) return;

    setLoadingBalance(true);
    try {
      const bal = await getBaseBalance(selectedToken, baseAddress);
      setBalance(bal);
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setLoadingBalance(false);
    }
  };

  const updateQuote = async () => {
    try {
      const q = await getQuote(selectedToken, amount);
      setQuote(q);
    } catch (error) {
      console.error('Failed to get quote:', error);
    }
  };

  const checkTokenApproval = async () => {
    if (!baseAddress || !amount) return;

    try {
      const approved = await checkApproval(selectedToken, baseAddress, amount);
      setIsApproved(approved);
    } catch (error) {
      console.error('Failed to check approval:', error);
    }
  };

  const handleApprove = async () => {
    if (!walletClient || !amount) return;

    setIsApproving(true);
    try {
      const hash = await approveToken(selectedToken, amount, walletClient);

      toast({
        title: 'Approval Successful',
        description: (
          <div className="flex items-center gap-2">
            <span>Token approved for bridge</span>
            <a
              href={`https://basescan.org/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-sky-300"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        ),
      });

      setIsApproved(true);
    } catch (error: any) {
      toast({
        title: 'Approval Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleBridge = async () => {
    if (!walletClient || !amount || !keetaAddress) return;

    setIsBridging(true);
    setBridgeStatus({ status: 'pending' });

    try {
      const status = await bridgeToKeeta(
        selectedToken,
        amount,
        keetaAddress,
        walletClient,
        (newStatus) => {
          setBridgeStatus(newStatus);
        }
      );

      toast({
        title: 'Bridge Completed!',
        description: (
          <div className="space-y-2">
            <div>Successfully bridged {amount} {selectedToken} to Keeta</div>
            {status.keetaTxHash && (
              <a
                href={`https://explorer.test.keeta.com/tx/${status.keetaTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 hover:text-sky-300 flex items-center gap-1"
              >
                View on Keeta Explorer
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ),
      });

      // Reset form
      setAmount('');
      setQuote(null);
      setIsApproved(false);
      await fetchBalance();
      onBridgeComplete?.();
    } catch (error: any) {
      toast({
        title: 'Bridge Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsBridging(false);
    }
  };

  const tokenConfig = ANCHOR_CONFIG.supportedTokens[selectedToken];

  // Show connection requirements
  if (!isConnected || !keetaAddress) {
    return (
      <Card className="bridge-card glass-card-elevated">
        <CardHeader>
          <CardTitle>Bridge from Base to Keeta</CardTitle>
          <CardDescription>Connect both wallets to start bridging</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Base Wallet Status */}
            <div className={`rounded-lg border p-4 ${isConnected ? 'border-green-500/30 bg-green-500/5' : 'border-white/10 bg-white/5'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`rounded-full p-2 ${isConnected ? 'bg-green-500/20' : 'bg-white/10'}`}>
                    {isConnected ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    ) : (
                      <Loader2 className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">Base Wallet (Source)</div>
                    <div className="text-xs text-muted-foreground">
                      {isConnected ? `Connected: ${baseAddress?.slice(0, 6)}...${baseAddress?.slice(-4)}` : 'Not connected'}
                    </div>
                  </div>
                </div>
                {!isConnected && (
                  <div className="text-xs text-muted-foreground">
                    Use header button →
                  </div>
                )}
              </div>
            </div>

            {/* Keeta Wallet Status */}
            <div className={`rounded-lg border p-4 ${keetaAddress ? 'border-green-500/30 bg-green-500/5' : 'border-white/10 bg-white/5'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`rounded-full p-2 ${keetaAddress ? 'bg-green-500/20' : 'bg-white/10'}`}>
                    {keetaAddress ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    ) : (
                      <Loader2 className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">Keeta Wallet (Destination)</div>
                    <div className="text-xs text-muted-foreground">
                      {keetaAddress ? `Connected: ${keetaAddress.slice(0, 12)}...${keetaAddress.slice(-6)}` : 'Not connected'}
                    </div>
                  </div>
                </div>
                {!keetaAddress && (
                  <div className="text-xs text-muted-foreground">
                    Use header button →
                  </div>
                )}
              </div>
            </div>

            {/* Instructions */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="text-sm text-muted-foreground space-y-2">
                <p className="font-semibold text-white">To use the bridge:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Connect your <strong>Base wallet</strong> (MetaMask, Coinbase, etc) using the header button</li>
                  <li>Connect your <strong>Keeta wallet</strong> (Keythings) using the "Connect Keeta" button</li>
                  <li>Both wallets must be connected to bridge tokens</li>
                </ol>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bridge-card glass-card-elevated">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Bridge from Base to Keeta
          <span className="text-xs font-normal text-muted-foreground">
            (Est. {Math.floor(ANCHOR_CONFIG.estimatedBridgeTime / 60)} min)
          </span>
        </CardTitle>
        <CardDescription>
          Transfer tokens from Base network to your Keeta wallet
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Token Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Token</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ANCHOR_CONFIG.supportedTokens) as SupportedToken[]).map((token) => {
              const config = ANCHOR_CONFIG.supportedTokens[token];
              return (
                <button
                  key={token}
                  onClick={() => setSelectedToken(token)}
                  className={`flex items-center gap-2 p-3 rounded-lg border transition-all ${
                    selectedToken === token
                      ? 'border-white/30 bg-white/10'
                      : 'border-white/10 hover:border-white/20 bg-white/5'
                  }`}
                >
                  <img src={config.logo} alt={config.symbol} className="w-6 h-6 rounded-full" />
                  <span className="font-semibold">{config.symbol}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount Input */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium">Amount</label>
            <div className="text-xs text-muted-foreground">
              Balance: {loadingBalance ? <Loader2 className="inline h-3 w-3 animate-spin" /> : `${parseFloat(balance).toFixed(4)} ${selectedToken}`}
            </div>
          </div>
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent text-2xl font-semibold outline-none"
                step="any"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAmount(balance)}
                className="text-xs"
              >
                MAX
              </Button>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center">
          <div className="rounded-full bg-card p-2 border border-white/10">
            <ArrowDown className="h-4 w-4" />
          </div>
        </div>

        {/* Quote Display */}
        {quote && (
          <div className="glass-card rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">You'll receive</span>
              <span className="font-semibold">{parseFloat(quote.amountOut).toFixed(6)} {selectedToken}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Anchor fee (0.1%)</span>
              <span>{parseFloat(quote.anchorFee).toFixed(6)} {selectedToken}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Silverback fee (0.5%)</span>
              <span>{parseFloat(quote.silverbackFee).toFixed(6)} {selectedToken}</span>
            </div>
            <div className="border-t border-white/10 pt-2 flex justify-between text-xs">
              <span className="text-muted-foreground">Total fees</span>
              <span>{parseFloat(quote.totalFee).toFixed(6)} {selectedToken}</span>
            </div>
          </div>
        )}

        {/* Bridge Status */}
        {bridgeStatus && bridgeStatus.status !== 'pending' && (
          <div className="glass-card rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              {bridgeStatus.status === 'completed' ? (
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              ) : (
                <Clock className="h-5 w-5 text-amber-400 animate-pulse" />
              )}
              <span className="font-medium capitalize">{bridgeStatus.status}</span>
            </div>
            {bridgeStatus.lockTxHash && (
              <a
                href={`https://basescan.org/tx/${bridgeStatus.lockTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
              >
                View Base transaction
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {bridgeStatus.keetaTxHash && (
              <a
                href={`https://explorer.test.keeta.com/tx/${bridgeStatus.keetaTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
              >
                View Keeta transaction
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2">
          {!isApproved && amount && parseFloat(amount) > 0 ? (
            <Button
              onClick={handleApprove}
              disabled={isApproving || !amount}
              className="w-full h-12 bg-gradient-to-br from-white/20 to-white/10 hover:from-white/30 hover:to-white/20 border border-white/20 text-white font-semibold"
            >
              {isApproving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Approving...
                </>
              ) : (
                `Approve ${selectedToken}`
              )}
            </Button>
          ) : (
            <Button
              onClick={handleBridge}
              disabled={isBridging || !isApproved || !amount || parseFloat(amount) <= 0}
              className="w-full h-12 bg-gradient-to-br from-white/20 to-white/10 hover:from-white/30 hover:to-white/20 border border-white/20 text-white font-semibold disabled:opacity-50"
            >
              {isBridging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Bridging...
                </>
              ) : (
                'Bridge to Keeta'
              )}
            </Button>
          )}
        </div>

        {/* Warning */}
        <div className="text-xs text-muted-foreground text-center">
          Make sure your Keeta address is correct. Bridged tokens cannot be recovered if sent to the wrong address.
        </div>
      </CardContent>
    </Card>
  );
}

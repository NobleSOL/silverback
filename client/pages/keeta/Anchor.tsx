import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Wallet,
  Copy,
  CheckCircle2,
  Send,
  Info,
  ArrowLeftRight,
} from "lucide-react";
import { useKeetaWallet } from "@/contexts/KeetaWalletContext";
import { BridgeFromBase } from "@/components/Bridge/BridgeFromBase";
import "@/styles/bridge.css";

export default function KeetaAnchor() {
  const {
    wallet,
    showAllTokens,
    setShowAllTokens,
    copiedAddress,
    tokenPrices,
    displayedTokens,
    disconnectWallet,
    copyToClipboard,
    setSendToken,
    setSendRecipient,
    setSendAmount,
    setSendDialogOpen,
    refreshBalances,
  } = useKeetaWallet();

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="container py-10">
        <div className="mx-auto max-w-6xl">
          {/* Page Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="rounded-lg bg-white/10 p-2">
                <ArrowLeftRight className="h-6 w-6 text-sky-400" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Anchor Bridge</h1>
                <p className="text-muted-foreground">Bridge assets between Base and Keeta networks</p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left Column: Bridge */}
            <div className="space-y-6">
              <BridgeFromBase
                keetaAddress={wallet?.address}
                onBridgeComplete={refreshBalances}
              />
            </div>

            {/* Right Column: Portfolio */}
            <div className="space-y-6">
              {wallet ? (
                <Card className="glass-card-elevated rounded-2xl">
                  <CardHeader>
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="rounded-lg bg-white/10 p-2 flex-shrink-0">
                          <Wallet className="h-5 w-5 text-sky-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-lg">Keeta Wallet</CardTitle>
                          <div className="flex items-center gap-2 mt-1">
                            <code className="text-xs font-mono text-muted-foreground truncate block max-w-[180px]">
                              {wallet.address.slice(0, 12)}...{wallet.address.slice(-8)}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 flex-shrink-0"
                              onClick={() => copyToClipboard(wallet.address)}
                            >
                              {copiedAddress ? (
                                <CheckCircle2 className="h-3 w-3 text-green-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                          {wallet.isKeythings && (
                            <div className="flex items-center gap-1 mt-1">
                              <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                              <span className="text-xs text-green-400 font-medium">Connected via Keythings</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={disconnectWallet}
                        className="w-full"
                      >
                        Disconnect
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {displayedTokens.map((token) => (
                        <div
                          key={token.address}
                          className="group relative rounded-xl border border-white/10 bg-white/5 p-4 transition-all hover:border-white/20 hover:bg-white/10"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {/* Token Icon */}
                              {token.symbol === "KTA" ? (
                                <div className="flex h-10 w-10 items-center justify-center rounded-full overflow-hidden bg-gradient-to-br from-white/20 to-white/10">
                                  <img
                                    src="https://assets.kraken.com/marketing/web/icons-uni-webp/s_kta.webp?i=kds"
                                    alt="KTA"
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-white/20 to-white/10 text-sm font-bold text-white">
                                  {token.symbol.slice(0, 2)}
                                </div>
                              )}
                              <div>
                                <div className="text-base font-semibold">{token.symbol}</div>
                                <code
                                  className="text-xs text-muted-foreground cursor-pointer hover:text-sky-400 transition-colors"
                                  onClick={() => copyToClipboard(token.address)}
                                  title="Click to copy address"
                                >
                                  {token.address.slice(0, 6)}...{token.address.slice(-4)}
                                </code>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => {
                                  setSendToken(token);
                                  setSendRecipient("");
                                  setSendAmount("");
                                  setSendDialogOpen(true);
                                }}
                              >
                                <Send className="h-3 w-3" />
                              </Button>
                              <div className="text-right">
                                <div className="text-lg font-bold">{token.balanceFormatted}</div>
                                <div className="text-xs text-muted-foreground">{token.symbol}</div>
                                {tokenPrices?.[token.address]?.priceUsd && (
                                  <div className="text-xs text-muted-foreground">
                                    ${(parseFloat(token.balanceFormatted) * tokenPrices[token.address].priceUsd!).toFixed(2)} USD
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                      {wallet.tokens.length > 5 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAllTokens(!showAllTokens)}
                          className="w-full text-sm hover:bg-white/10"
                        >
                          {showAllTokens ? (
                            <span>Show Less</span>
                          ) : (
                            <span>Show {wallet.tokens.length - 5} More Token{wallet.tokens.length - 5 > 1 ? 's' : ''}</span>
                          )}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="glass-card-elevated rounded-2xl">
                  <CardHeader>
                    <CardTitle>Keeta Portfolio</CardTitle>
                    <CardDescription>
                      Connect your Keeta wallet to view your portfolio and receive bridged assets
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-center py-8">
                    <div className="flex flex-col items-center gap-4">
                      <div className="rounded-full bg-white/10 p-4">
                        <Wallet className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Use the "Connect Keeta" button in the header to connect your Keythings wallet
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Info Card */}
              <Card className="glass-card rounded-2xl">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-sky-400" />
                    <CardTitle className="text-sm">Bridge Information</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>• Bridge from Base to Keeta in ~3 minutes</p>
                  <p>• 0.6% total fee (0.1% Anchor + 0.5% Silverback)</p>
                  <p>• Supported: USDC, KTA</p>
                  <p>• Connect both wallets to start bridging</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

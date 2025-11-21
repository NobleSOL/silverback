import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { base } from "viem/chains";
import { useNetwork } from "@/contexts/NetworkContext";
import { toast } from "@/hooks/use-toast";
import {
  isKeythingsInstalled,
  connectKeythings,
  getSelectedAddress,
  isConnected as isKeythingsConnected,
  onAccountsChanged,
  onDisconnect as onKeythingsDisconnect,
} from "@/lib/keythings-provider";

function truncate(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function ConnectButton() {
  const { network } = useNetwork();
  const { address, isConnected } = useAccount();
  const { connectors, connect, status, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Keythings wallet state (for Keeta network)
  const [keythingsAddress, setKeythingsAddress] = useState<string | null>(null);
  const [keythingsConnecting, setKeythingsConnecting] = useState(false);

  // Check Keythings wallet connection state on mount and when switching to Keeta network
  useEffect(() => {
    if (network === "Keeta") {
      if (isKeythingsInstalled() && isKeythingsConnected()) {
        const address = getSelectedAddress();
        setKeythingsAddress(address);
      } else {
        setKeythingsAddress(null);
      }

      // Listen for account changes
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length > 0) {
          setKeythingsAddress(accounts[0]);
        } else {
          setKeythingsAddress(null);
        }
      };

      const handleDisconnect = () => {
        setKeythingsAddress(null);
      };

      onAccountsChanged(handleAccountsChanged);
      onKeythingsDisconnect(handleDisconnect);
    }
  }, [network]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  // Handle Keythings wallet connection
  const handleKeythingsConnect = async () => {
    if (!isKeythingsInstalled()) {
      toast({
        title: "Keythings Wallet Not Found",
        description: "Please install the Keythings wallet extension to connect to Keeta network.",
        variant: "destructive",
      });
      return;
    }

    setKeythingsConnecting(true);
    try {
      const accounts = await connectKeythings();
      if (accounts && accounts.length > 0) {
        setKeythingsAddress(accounts[0]);
        toast({
          title: "Wallet Connected",
          description: `Connected to ${truncate(accounts[0])}`,
        });
      }
    } catch (error: any) {
      console.error("Failed to connect Keythings wallet:", error);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to Keythings wallet",
        variant: "destructive",
      });
    } finally {
      setKeythingsConnecting(false);
    }
  };

  const handleKeythingsDisconnect = () => {
    setKeythingsAddress(null);
    toast({
      title: "Wallet Disconnected",
      description: "Disconnected from Keythings wallet",
    });
  };

  // Keeta network - show Keythings wallet
  if (network === "Keeta") {
    if (keythingsAddress) {
      return (
        <div className="relative" ref={ref}>
          <Button onClick={() => setOpen((o) => !o)}>
            {truncate(keythingsAddress)}
          </Button>
          {open && (
            <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md">
              <button
                className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  handleKeythingsDisconnect();
                  setOpen(false);
                }}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <Button onClick={handleKeythingsConnect} disabled={keythingsConnecting}>
        {keythingsConnecting ? "Connecting..." : "Connect Wallet"}
      </Button>
    );
  }

  // Base network - show wagmi wallet (MetaMask, Phantom, etc.)
  if (isConnected)
    return (
      <div className="relative" ref={ref}>
        <Button onClick={() => setOpen((o) => !o)}>{truncate(address)}</Button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md">
            <button
              className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );

  const connectPreferred = () => {
    // Auto-connect with preferred wallet (MetaMask/injected first, then fallback)
    const preferred = connectors.find((c) => c.id === "injected") ?? connectors[0];
    if (preferred) {
      connect({ connector: preferred, chainId: base.id });
    }
  };

  return (
    <div className="relative" ref={ref}>
      <Button onClick={connectPreferred}>Connect Wallet</Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md">
          {connectors.map((c) => (
            <button
              key={c.id}
              className={cn(
                "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
                {
                  "opacity-50": !c.ready,
                },
              )}
              disabled={!c.ready}
              onClick={() => {
                connect({ connector: c, chainId: base.id });
                setOpen(false);
              }}
            >
              {c.name}
            </button>
          ))}
          {status === "error" && (
            <div className="px-3 py-2 text-xs text-destructive-foreground">
              {error?.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, Wallet2, Menu } from "lucide-react";
import ConnectButton from "@/components/wallet/ConnectButton";
import { useNetwork } from "@/contexts/NetworkContext";

const NavItem = ({ to, label }: { to: string; label: string }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      cn(
        "px-3 py-2 rounded-md text-sm font-medium transition-colors",
        isActive
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
      )
    }
  >
    {label}
  </NavLink>
);

export function Header() {
  const location = useLocation();
  const { network, setNetwork } = useNetwork();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (open && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
      if (mobileOpen && mobileRef.current && !mobileRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open, mobileOpen]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="https://cdn.builder.io/api/v1/image/assets%2Fd70091a6f5494e0195b033a72f7e79ae%2Fee3a0a5652aa480f9aa42277503e94b2?format=webp&width=64"
              alt="Silverback logo"
              className="h-8 w-8 rounded-md object-contain flex-shrink-0"
            />
            <span className="hidden sm:inline text-sm sm:text-base md:text-lg font-extrabold tracking-tight uppercase whitespace-nowrap">
              Silverback
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <NavItem to="/" label="Swap" />
            <NavItem to="/pool" label="Pool" />
            <NavItem to="/portfolio" label="Positions" />
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative md:hidden" ref={mobileRef}>
            <Button
              variant="secondary"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation menu"
              aria-haspopup="menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              <Menu />
            </Button>
            {mobileOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-40 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md z-50"
              >
                <Link to="/" className="block rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => setMobileOpen(false)}>Swap</Link>
                <Link to="/pool" className="block rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => setMobileOpen(false)}>Pool</Link>
                <Link to="/portfolio" className="block rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => setMobileOpen(false)}>Positions</Link>
              </div>
            )}
          </div>

          <div className="relative" ref={menuRef}>
            <Button
              variant="secondary"
              className="gap-1 sm:gap-2 px-2 sm:px-4"
              size="sm"
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <div
                className={cn(
                  "size-2 rounded-full animate-pulse",
                  network === "Base" ? "bg-sky-400" : "bg-[#FF6F5E]",
                )}
              />
              <span className="font-semibold text-xs sm:text-sm">{network}</span>
              <ChevronDown className="opacity-70 h-3 w-3 sm:h-4 sm:w-4" />
            </Button>
            {open && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-36 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md z-50"
              >
                <button
                  className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setNetwork("Base");
                    setOpen(false);
                  }}
                >
                  Base
                </button>
                <button
                  className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setNetwork("Keeta");
                    setOpen(false);
                  }}
                >
                  Keeta
                </button>
              </div>
            )}
          </div>
          <div>
            {/* Wagmi-based connect */}
            <ConnectButton />
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;

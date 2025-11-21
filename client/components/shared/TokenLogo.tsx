import { useEffect, useState } from "react";

export function TokenLogo({
  src,
  alt,
  size = 20,
}: {
  src?: string;
  alt: string;
  size?: number;
}) {
  const [error, setError] = useState(false);

  // Reset the error flag when the src changes so images appear when cycling tokens
  useEffect(() => {
    setError(false);
  }, [src]);

  const letter = (alt?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-foreground/80"
      style={{ width: size, height: size }}
      aria-label={alt}
    >
      {!error && src ? (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setError(true)}
        />
      ) : (
        <span>{letter}</span>
      )}
    </span>
  );
}

export default TokenLogo;

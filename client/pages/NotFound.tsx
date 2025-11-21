import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-6xl font-extrabold text-brand">404</h1>
        <p className="mt-2 text-lg text-muted-foreground">Page not found</p>
        <a
          href="/"
          className="mt-4 inline-block rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand/90"
        >
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;

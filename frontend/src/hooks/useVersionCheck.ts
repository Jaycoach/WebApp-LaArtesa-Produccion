import { useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 15_000;

export const useVersionCheck = () => {
  const initialVersion = useRef<string | null>(null);
  const [hayNuevaVersion, setHayNuevaVersion] = useState(false);

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_URL || '/api';

    const check = async () => {
      try {
        const res = await fetch(`${apiBase}/version?t=${Date.now()}`);
        if (!res.ok) return;
        const { version } = await res.json();
        if (!initialVersion.current) {
          initialVersion.current = version;
          return;
        }
        if (version !== initialVersion.current) {
          setHayNuevaVersion(true);
        }
      } catch {
        // red caída — no interrumpir
      }
    };

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { hayNuevaVersion };
};

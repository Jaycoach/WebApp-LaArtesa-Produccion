/**
 * ScrollToTop.tsx — ARTESA
 * Restaura el scroll a la parte superior de la ventana en cada cambio de ruta.
 * React Router (client-side) no resetea el scroll por defecto al navegar entre
 * páginas, ya que no hay recarga real del documento.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;

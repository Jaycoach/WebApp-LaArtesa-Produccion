/**
 * ScrollToTop.tsx — ARTESA
 * Restaura el scroll a la parte superior de la ventana en cada cambio de ruta.
 * React Router (client-side) no resetea el scroll por defecto al navegar entre
 * páginas, ya que no hay recarga real del documento.
 *
 * Además, tras una navegación SPA (sin recarga real), Chrome puede conservar
 * el cálculo de posición de elementos `sticky` (como BarraNavegacionFases)
 * de la ruta anterior, dejándolos visualmente "atascados" en el offset viejo
 * hasta que ocurre un evento real de scroll. El micro-scroll (0 -> 1 -> 0)
 * fuerza ese recálculo sin que el usuario lo perciba.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);

    requestAnimationFrame(() => {
      window.scrollTo(0, 1);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    });
  }, [pathname]);

  return null;
};

export default ScrollToTop;

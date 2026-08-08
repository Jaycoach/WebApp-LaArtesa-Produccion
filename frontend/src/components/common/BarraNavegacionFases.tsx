import React from 'react';
import { useNavigate } from 'react-router-dom';

interface FaseAdyacente {
  label: string;
  ruta: string;
}

interface FaseSiguiente extends FaseAdyacente {
  habilitada: boolean;
  loading?: boolean;
  onClick?: () => void; // si se define, se usa en vez de navigate(ruta) directo (ej: completar fase + navegar)
}

interface AccionExtra {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

interface BarraNavegacionFasesProps {
  masaId?: string | number;
  codigoMasa?: string;
  faseAnterior?: FaseAdyacente;
  faseSiguiente?: FaseSiguiente;
  accionExtra?: AccionExtra;
}

/**
 * Barra de navegación entre fases — sticky bajo el header (top-16).
 * Reemplaza los botones dispersos "Volver al detalle" / "← Fase" / "Fase →"
 * que existían duplicados arriba y abajo en cada pantalla de fase.
 *
 * Grupo izquierdo: navegación general (Home / Detalle de la masa) — siempre visible.
 * Grupo derecho: navegación entre fases adyacentes — dinámico según la fase actual,
 * mismo masaId siempre (nunca dispara lógica de fecha/sessionStorage).
 */
export const BarraNavegacionFases: React.FC<BarraNavegacionFasesProps> = ({
  masaId,
  codigoMasa,
  faseAnterior,
  faseSiguiente,
  accionExtra,
}) => {
  const navigate = useNavigate();

  const handleSiguiente = () => {
    if (!faseSiguiente || !faseSiguiente.habilitada || faseSiguiente.loading) return;
    if (faseSiguiente.onClick) {
      faseSiguiente.onClick();
    } else {
      navigate(faseSiguiente.ruta);
    }
  };

  return (
    <div className="sticky top-16 z-10 bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-2 mb-4 flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/planificacion/masas')}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
          title="Todas las masas planificadas"
        >
          🏠 Todas las masas
        </button>
        {masaId != null && (
          <button
            onClick={() => navigate(`/planificacion/masas/${masaId}`)}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
            title="Detalle de la masa"
          >
            📄 {codigoMasa || 'Detalle'}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {faseAnterior && (
          <button
            onClick={() => navigate(faseAnterior.ruta)}
            className="flex items-center gap-1 px-4 py-2 bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-lg text-sm font-medium shadow-sm transition-colors"
          >
            ← {faseAnterior.label}
          </button>
        )}
        {accionExtra && (
          <button
            onClick={accionExtra.onClick}
            disabled={accionExtra.disabled || accionExtra.loading}
            className="flex items-center gap-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
          >
            {accionExtra.loading ? '⏳ Enviando a SAP...' : accionExtra.label}
          </button>
        )}
        {faseSiguiente && (
          <button
            onClick={handleSiguiente}
            disabled={!faseSiguiente.habilitada || faseSiguiente.loading}
            title={!faseSiguiente.habilitada ? 'Completa esta fase primero' : undefined}
            className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
          >
            {faseSiguiente.loading ? 'Procesando...' : `${faseSiguiente.label} →`}
          </button>
        )}
      </div>
    </div>
  );
};

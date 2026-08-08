import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store';
import masasService from '@/services/masasService';

const FASE_CONFIG: Record<string, {
  label: string; color: string; bgColor: string;
  borderColor: string; dotColor: string; icon: string;
}> = {
  pesaje:       { label: 'Pesaje',       color: 'text-blue-700',   bgColor: 'bg-blue-50',   borderColor: 'border-blue-200',   dotColor: 'bg-blue-500',   icon: '⚖️'  },
  amasado:      { label: 'Amasado',      color: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-200', dotColor: 'bg-purple-500', icon: '🔄' },
  division:     { label: 'División',     color: 'text-yellow-700', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200', dotColor: 'bg-yellow-500', icon: '✂️'  },
  formado:      { label: 'Formado',      color: 'text-green-700',  bgColor: 'bg-green-50',  borderColor: 'border-green-200',  dotColor: 'bg-green-500',  icon: '🍞' },
  fermentacion: { label: 'Fermentación', color: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-200', dotColor: 'bg-orange-500', icon: '🌡️' },
  horneado:     { label: 'Horneado',     color: 'text-red-700',    bgColor: 'bg-red-50',    borderColor: 'border-red-200',    dotColor: 'bg-red-500',    icon: '🔥' },
};

const formatFecha = (fechaStr: string) => {
  const [year, month, day] = fechaStr.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day))
    .toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

const getEstadoBadge = (estado: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    PLANIFICACION: { label: 'Planificación', cls: 'bg-gray-100 text-gray-700'      },
    APROBADA:      { label: 'Aprobada',      cls: 'bg-green-100 text-green-700'    },
    PESAJE:        { label: 'En Pesaje',     cls: 'bg-blue-100 text-blue-700'      },
    AMASADO:       { label: 'En Amasado',    cls: 'bg-purple-100 text-purple-700'  },
    DIVISION:      { label: 'En División',   cls: 'bg-yellow-100 text-yellow-700'  },
    FORMADO:       { label: 'En Formado',    cls: 'bg-green-100 text-green-700'    },
    FERMENTACION:  { label: 'Fermentación',  cls: 'bg-orange-100 text-orange-700'  },
    HORNEADO:      { label: 'Horneado',      cls: 'bg-red-100 text-red-700'        },
    COMPLETADA:    { label: 'Completada',    cls: 'bg-emerald-100 text-emerald-700' },
    CANCELADA:     { label: 'Cancelada',     cls: 'bg-red-100 text-red-600'        },
  };
  const cfg = map[estado] ?? { label: estado, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

interface Masa {
  id: number;
  codigo_masa: string;
  tipo_masa: string;
  nombre_masa: string;
  estado: string;
  fase_actual: string;
  total_kilos_con_merma: number;
  total_kilos_pesado_real: number;
  total_productos: number;
  total_unidades_programadas: number;
  es_repeticion?: boolean;
  es_adicional?: boolean;
  prioridad?: boolean;
}

const MasaCard = ({
  masa, faseKey, canEdit, onNavigate,
}: {
  masa: Masa; faseKey: string; canEdit: boolean;
  onNavigate: (masaId: number, faseKey: string) => void;
}) => {
  const cfg = FASE_CONFIG[faseKey];
  return (
    <div
      className={`rounded-lg border p-4 transition-all bg-white
        ${masa.es_repeticion ? 'border-red-300 bg-red-50' : masa.prioridad ? 'border-purple-300 bg-purple-50' : cfg.borderColor}
        ${canEdit ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : 'opacity-90'}`}
      onClick={() => canEdit && onNavigate(masa.id, faseKey)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-mono font-semibold ${cfg.color}`}>{masa.codigo_masa}</span>
            {masa.es_repeticion && (
              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-red-200 text-red-800">
                REPETICIÓN
              </span>
            )}
            {!masa.es_repeticion && masa.prioridad && (
              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-purple-200 text-purple-800">
                PRIORITARIA
              </span>
            )}
            {masa.es_adicional && (
              <span
                className="px-1.5 py-0.5 rounded text-xs font-bold text-white uppercase tracking-wide"
                style={{ backgroundColor: '#f97316' }}
              >
                ADICIONAL
              </span>
            )}
          </div>
          <h3 className="font-semibold text-gray-900 truncate mt-0.5">{masa.tipo_masa}</h3>
          <p className="text-xs text-gray-500 truncate">{masa.nombre_masa}</p>
        </div>
        <div className="shrink-0">{getEstadoBadge(masa.estado)}</div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className={`rounded p-1.5 ${cfg.bgColor}`}>
          <p className={`text-sm font-bold ${cfg.color}`}>{Number(masa.total_kilos_pesado_real > 0 ? masa.total_kilos_pesado_real : masa.total_kilos_con_merma).toFixed(1)} kg</p>
          <p className="text-xs text-gray-500">Kilos</p>
        </div>
        <div className={`rounded p-1.5 ${cfg.bgColor}`}>
          <p className={`text-sm font-bold ${cfg.color}`}>{masa.total_productos ?? 0}</p>
          <p className="text-xs text-gray-500">Productos</p>
        </div>
        <div className={`rounded p-1.5 ${cfg.bgColor}`}>
          <p className={`text-sm font-bold ${cfg.color}`}>{masa.total_unidades_programadas ?? 0}</p>
          <p className="text-xs text-gray-500">Unidades</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${cfg.dotColor}`} />
          <span className="text-xs text-gray-500">
            Fase actual: <strong>{masa.fase_actual}</strong>
          </span>
        </div>
        {canEdit
          ? <span className={`text-xs font-medium ${cfg.color}`}>Ver detalle →</span>
          : <span className="text-xs text-gray-400">Solo lectura</span>
        }
      </div>
    </div>
  );
};

const FaseListado = () => {
  const { nombreFase } = useParams<{ nombreFase: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  // Fecha de hoy en horario Colombia (America/Bogota), no UTC del navegador/servidor.
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [fecha, setFecha] = useState(() => {
    return sessionStorage.getItem('artesa_fecha_produccion') || hoy;
  });

  const faseKey = (nombreFase ?? '').toLowerCase();
  const cfg = FASE_CONFIG[faseKey];
  const canEdit = ['admin', 'supervisor'].includes(user?.rol ?? '');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['masas-por-fase', faseKey, fecha],
    queryFn: () => masasService.getMasasByFecha(fecha, faseKey.toUpperCase()),
    enabled: !!faseKey && !!cfg,
  });

  const masasSinOrdenar: Masa[] = (data as any)?.data ?? (data as any) ?? [];
  const masas: Masa[] = [...masasSinOrdenar].sort((a, b) => {
    const prioridadA = Number(a.es_repeticion) + Number(a.es_adicional) + Number(a.prioridad);
    const prioridadB = Number(b.es_repeticion) + Number(b.es_adicional) + Number(b.prioridad);
    return prioridadB - prioridadA;
  });

  const handleNavigate = (masaId: number, fase: string) => {
    sessionStorage.setItem('artesa_masa_activa', String(masaId));
    const rutasMap: Record<string, string> = {
      pesaje:       `/pesaje/${masaId}`,
      amasado:      `/amasado/${masaId}`,
      division:     `/division/${masaId}`,
      formado:      `/formado/${masaId}`,
      fermentacion: `/fermentacion/${masaId}`,
      horneado:     `/horneado/${masaId}`,
    };
    const ruta = rutasMap[fase];
    if (ruta) navigate(ruta);
  };

  if (!cfg) {
    return (
      <div className="p-8 text-center text-gray-500">
        Fase <strong>{nombreFase}</strong> no reconocida.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`rounded-xl border ${cfg.borderColor} ${cfg.bgColor} p-6`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{cfg.icon}</span>
            <div>
              <h1 className={`text-2xl font-bold ${cfg.color}`}>{cfg.label}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {canEdit
                  ? 'Puedes ver y editar las masas en esta fase'
                  : 'Vista de solo lectura — histórico de esta fase'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-600">Fecha:</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => { sessionStorage.setItem('artesa_fecha_produccion', e.target.value); setFecha(e.target.value); }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>

      {/* Subtítulo fecha */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 capitalize">{formatFecha(fecha)}</p>
        <button
          onClick={() => refetch()}
          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          ↻ Actualizar
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary-500 border-t-transparent" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700 font-medium">Error al cargar las masas</p>
          <button onClick={() => refetch()} className="mt-2 text-sm text-red-600 underline">
            Reintentar
          </button>
        </div>
      )}

      {/* Sin resultados */}
      {!isLoading && !isError && masas.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
          <span className="text-4xl">{cfg.icon}</span>
          <p className="mt-3 text-gray-500 font-medium">
            No hay masas en fase <strong>{cfg.label}</strong> para esta fecha
          </p>
          <p className="text-sm text-gray-400 mt-1">
            Prueba con otra fecha o verifica que las masas hayan avanzado a esta fase
          </p>
        </div>
      )}

      {/* Grid de masas */}
      {!isLoading && !isError && masas.length > 0 && (
        <>
          <p className="text-sm text-gray-500">
            {masas.length} masa{masas.length !== 1 ? 's' : ''} encontrada{masas.length !== 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {masas.map((masa) => (
              <MasaCard
                key={masa.id}
                masa={masa}
                faseKey={faseKey}
                canEdit={canEdit}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default FaseListado;

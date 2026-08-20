// frontend/src/components/common/MasasFiltroDropdown.tsx

import React, { useEffect, useRef, useState } from 'react';
import { MasaProduccionResumen } from '../../types/api';

export interface OpcionFiltroMasa {
  id: string;
  label: string;
}

const FILTRO_FASE: OpcionFiltroMasa[] = [
  { id: 'fase:PLANIFICACION', label: 'Planificación' },
  { id: 'fase:PESAJE', label: 'Pesaje' },
  { id: 'fase:AMASADO', label: 'Amasado' },
  { id: 'fase:DIVISION', label: 'División' },
  { id: 'fase:FORMADO', label: 'Formado' },
  { id: 'fase:FERMENTACION', label: 'Fermentación' },
  { id: 'fase:HORNEADO', label: 'Horneado' },
  { id: 'fase:EMPAQUE', label: 'Empaque' },
];

const FILTRO_ESTADO: OpcionFiltroMasa[] = [
  { id: 'estado:PENDIENTE', label: 'Pendiente' },
  { id: 'estado:APROBADA', label: 'Aprobada' },
  { id: 'estado:EN_PROCESO', label: 'En proceso' },
  { id: 'estado:COMPLETADA', label: 'Completada' },
  { id: 'estado:CANCELADA', label: 'Cancelada' },
  { id: 'estado:SUBDIVIDIDA', label: 'Subdividida' },
];

const FILTRO_ATRIBUTO: OpcionFiltroMasa[] = [
  { id: 'attr:REPETICION', label: 'Repetición' },
  { id: 'attr:ADICIONAL', label: 'Adicional' },
  { id: 'attr:PRIORITARIA', label: 'Prioritaria' },
  { id: 'attr:SUBDIVISION', label: 'Es subdivisión' },
];

/**
 * Evalúa si una masa cumple la selección de filtros: OR dentro de cada
 * sección (fase/estado/atributo), AND entre secciones. Selección vacía
 * ("Todas") no filtra nada.
 */
export const masaCumpleFiltro = (masa: MasaProduccionResumen, seleccion: Set<string>): boolean => {
  if (seleccion.size === 0) return true;

  const fases = Array.from(seleccion).filter(id => id.startsWith('fase:'));
  const estados = Array.from(seleccion).filter(id => id.startsWith('estado:'));
  const atributos = Array.from(seleccion).filter(id => id.startsWith('attr:'));

  if (fases.length > 0 && !fases.includes(`fase:${masa.fase_actual}`)) return false;
  if (estados.length > 0 && !estados.includes(`estado:${masa.estado}`)) return false;

  if (atributos.length > 0) {
    const cumpleAlguno = atributos.some(id => {
      switch (id) {
        case 'attr:REPETICION': return !!masa.es_repeticion;
        case 'attr:ADICIONAL': return !!masa.es_adicional;
        case 'attr:PRIORITARIA': return !!masa.prioridad;
        case 'attr:SUBDIVISION': return !!masa.es_subdivision;
        default: return false;
      }
    });
    if (!cumpleAlguno) return false;
  }

  return true;
};

interface Props {
  seleccion: Set<string>;
  onChange: (next: Set<string>) => void;
}

/**
 * Dropdown multi-select agrupado (fase / estado / atributo) para filtrar
 * el listado de masas. "Todas" se representa como selección vacía: nunca
 * queda un estado intermedio con 0 opciones marcadas y 0 masas visibles.
 */
export const MasasFiltroDropdown: React.FC<Props> = ({ seleccion, onChange }) => {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickFuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  const todasActivo = seleccion.size === 0;

  const toggleOpcion = (id: string) => {
    const next = new Set(seleccion);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  const renderGrupo = (titulo: string, opciones: OpcionFiltroMasa[]) => (
    <div className="mb-3 last:mb-0">
      <p className="text-xs font-semibold text-gray-400 uppercase px-1 mb-1">{titulo}</p>
      {opciones.map(op => (
        <label
          key={op.id}
          className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer select-none text-sm text-gray-700"
        >
          <input
            type="checkbox"
            checked={seleccion.has(op.id)}
            onChange={() => toggleOpcion(op.id)}
            className="w-4 h-4 accent-blue-600"
          />
          {op.label}
        </label>
      ))}
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50 flex items-center gap-2"
      >
        Filtros
        {!todasActivo && (
          <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
            {seleccion.size}
          </span>
        )}
        <span className="text-gray-400 text-xs">{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && (
        <div className="absolute z-30 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-h-96 overflow-y-auto">
          <label className="flex items-center gap-2 px-1 py-1 mb-2 pb-2 border-b border-gray-100 cursor-pointer select-none text-sm font-semibold text-gray-800">
            <input
              type="checkbox"
              checked={todasActivo}
              onChange={() => onChange(new Set())}
              className="w-4 h-4 accent-blue-600"
            />
            Todas
          </label>
          {renderGrupo('Por fase actual', FILTRO_FASE)}
          {renderGrupo('Por estado', FILTRO_ESTADO)}
          {renderGrupo('Por atributo', FILTRO_ATRIBUTO)}
        </div>
      )}
    </div>
  );
};

export default MasasFiltroDropdown;

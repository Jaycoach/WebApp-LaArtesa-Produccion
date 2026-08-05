import React, { useState, useEffect } from 'react';
import { useInfoCancelacionMasa, useCancelarMasa } from '../../hooks/useMasas';

interface ModalCancelarMasaProps {
  masaId: number;
  isOpen: boolean;
  onClose: () => void;
  onCancelada: () => void;
}

export const ModalCancelarMasa: React.FC<ModalCancelarMasaProps> = ({ masaId, isOpen, onClose, onCancelada }) => {
  const { data: info, isLoading } = useInfoCancelacionMasa(isOpen ? masaId : null);
  const cancelarMutation = useCancelarMasa();

  const [motivo, setMotivo] = useState('');
  const [lineasSeleccionadas, setLineasSeleccionadas] = useState<Record<string, boolean>>({});
  const [confirmacionParcial, setConfirmacionParcial] = useState<{
    mensaje: string;
    bloqueadas: { id: number; codigo_masa: string }[];
    cancelables: { id: number; codigo_masa: string }[];
  } | null>(null);
  const [resultadoSap, setResultadoSap] = useState<any[] | null>(null);

  useEffect(() => {
    if (info?.data?.lineas) {
      const iniciales: Record<string, boolean> = {};
      for (const l of info.data.lineas) {
        iniciales[`${l.sap_doc_entry}-${l.sap_line_num}`] = true;
      }
      setLineasSeleccionadas(iniciales);
    }
  }, [info]);

  useEffect(() => {
    if (isOpen) {
      setMotivo('');
      setConfirmacionParcial(null);
      setResultadoSap(null);
    }
  }, [isOpen, masaId]);

  if (!isOpen) return null;

  const lineas = info?.data?.lineas || [];
  const masas = info?.data?.masas || [];

  const toggleLinea = (key: string) => {
    setLineasSeleccionadas(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getLineasSeleccionadasPayload = () =>
    lineas
      .filter((l: any) => lineasSeleccionadas[`${l.sap_doc_entry}-${l.sap_line_num}`])
      .map((l: any) => ({ sap_doc_entry: l.sap_doc_entry, sap_line_num: l.sap_line_num }));

  const handleConfirmar = async (forzarParcial = false) => {
    if (!motivo.trim()) return;
    try {
      const respuesta = await cancelarMutation.mutateAsync({
        masaId,
        motivo: motivo.trim(),
        confirmarParcial: forzarParcial,
        lineasSeleccionadas: getLineasSeleccionadasPayload(),
      });
      setResultadoSap(respuesta.lineas_sap || []);
      setConfirmacionParcial(null);
      onCancelada();
    } catch (error: any) {
      if (error?.status === 409 && error?.data?.requiere_confirmacion) {
        setConfirmacionParcial({
          mensaje: error.message,
          bloqueadas: error.data.bloqueadas || [],
          cancelables: error.data.cancelables || [],
        });
        return;
      }
      alert(error?.message || 'Error desconocido al cancelar la masa');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Cancelar Masa</h3>
        <p className="text-sm text-gray-600 mb-4">
          Se liberará el stock reservado y se cerrarán en SAP las líneas de OV seleccionadas.
          El motivo es obligatorio.
        </p>

        {isLoading && <p className="text-sm text-gray-500">Cargando órdenes relacionadas...</p>}

        {!isLoading && masas.length > 1 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-semibold text-amber-800 mb-1">
              Esta cancelación incluye {masas.length} masa(s) relacionada(s):
            </p>
            <ul className="text-xs text-amber-700 list-disc list-inside">
              {masas.map((m: any) => (
                <li key={m.id}>
                  {m.codigo_masa}{m.bloqueada ? ' — con pesaje confirmado, no se puede cancelar' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isLoading && lineas.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">Líneas de OV a cerrar en SAP:</p>
            <div className="border border-gray-200 rounded-lg divide-y max-h-48 overflow-y-auto">
              {lineas.map((l: any) => {
                const key = `${l.sap_doc_entry}-${l.sap_line_num}`;
                return (
                  <label key={key} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={!!lineasSeleccionadas[key]}
                      onChange={() => toggleLinea(key)}
                    />
                    <span className="flex-1">
                      OV {l.sap_doc_num} — {l.sap_item_code} ({l.unidades_pedidas} und.)
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {!resultadoSap && (
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo de la cancelación (obligatorio)..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 text-sm resize-none"
          />
        )}

        {resultadoSap && (
          <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-xs font-semibold text-gray-700 mb-1">Resultado en SAP:</p>
            <ul className="text-xs space-y-1">
              {resultadoSap.map((r: any, i: number) => (
                <li key={i} className={r.exitosa ? 'text-green-700' : 'text-red-700'}>
                  {r.exitosa ? '✓' : '✗'} OV {r.doc_num} línea {r.line_num} ({r.item_code})
                  {!r.exitosa && r.mensaje ? ` — ${r.mensaje}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
          >
            {resultadoSap ? 'Cerrar' : 'Volver'}
          </button>
          {!resultadoSap && (
            <button
              onClick={() => handleConfirmar(false)}
              disabled={cancelarMutation.isPending || !motivo.trim() || isLoading}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {cancelarMutation.isPending ? 'Cancelando...' : 'Confirmar cancelación'}
            </button>
          )}
        </div>
      </div>

      {confirmacionParcial && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Cancelación parcial</h3>
            <p className="text-sm text-gray-600 mb-4">{confirmacionParcial.mensaje}</p>
            {confirmacionParcial.cancelables.length > 0 && (
              <p className="text-sm text-gray-700 mb-2">
                Se cancelarán: {confirmacionParcial.cancelables.map(c => c.codigo_masa).join(', ')} y la masa principal.
              </p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setConfirmacionParcial(null)}
                className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
              >
                Volver
              </button>
              <button
                onClick={() => handleConfirmar(true)}
                disabled={cancelarMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {cancelarMutation.isPending ? 'Cancelando...' : 'Cancelar de todas formas'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

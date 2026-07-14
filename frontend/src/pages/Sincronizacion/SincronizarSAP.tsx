import React, { useState } from 'react';
import { Card, Button } from '@/components/common';
import {
  useSincronizarBOM,
  useSincronizarSAP,
  useSincronizarInventarioMP,
  useSincronizarLotesItem,
} from '@/hooks/useMasas';

export const SincronizarSAP: React.FC = () => {
  const [fecha, setFecha] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [forzar, setForzar] = useState<boolean>(false);
  const [itemPuntual, setItemPuntual] = useState<string>('');
  const [segundosTranscurridos, setSegundosTranscurridos] = useState<number>(0);
  const [resultadoItemPuntual, setResultadoItemPuntual] = useState<{
    ok: boolean;
    mensaje: string;
  } | null>(null);

  const sincronizarBOMMutation = useSincronizarBOM();
  const sincronizarOVMutation = useSincronizarSAP();
  const sincronizarInventarioMutation = useSincronizarInventarioMP();
  const sincronizarLotesItemMutation = useSincronizarLotesItem();

  const algunaSincronizacionActiva =
    sincronizarBOMMutation.isPending ||
    sincronizarOVMutation.isPending ||
    sincronizarInventarioMutation.isPending ||
    sincronizarLotesItemMutation.isPending;

  React.useEffect(() => {
    if (!algunaSincronizacionActiva) {
      setSegundosTranscurridos(0);
      return;
    }
    const intervalo = setInterval(() => {
      setSegundosTranscurridos((s) => s + 1);
    }, 1000);
    return () => clearInterval(intervalo);
  }, [algunaSincronizacionActiva]);

  const formatearTiempo = (segundos: number) => {
    const min = Math.floor(segundos / 60);
    const seg = segundos % 60;
    return `${min}:${seg.toString().padStart(2, '0')}`;
  };

  const handleSyncBOM = async () => {
    try {
      await sincronizarBOMMutation.mutateAsync(undefined);
    } catch {
      // error manejado por el estado de la mutation
    }
  };

  const handleSyncOV = async () => {
    try {
      await sincronizarOVMutation.mutateAsync({ fecha, forzar });
    } catch {
      // error manejado por el estado de la mutation
    }
  };

  const handleSyncInventario = async () => {
    try {
      await sincronizarInventarioMutation.mutateAsync();
    } catch {
      // error manejado por isError
    }
  };

  // Un solo botón, un solo clic: actualiza receta+atributos Y stock+lotes de un
  // producto puntual, en secuencia. Reutiliza las mismas dos acciones que ya
  // existen (BOM con filtro, lotes con filtro) sin duplicar lógica de backend.
  const handleSyncItemPuntual = async () => {
    if (!itemPuntual.trim()) return;
    setResultadoItemPuntual(null);

    const bomOk = await sincronizarBOMMutation
      .mutateAsync(itemPuntual.trim())
      .then(() => true)
      .catch(() => false);

    const lotesOk = await sincronizarLotesItemMutation
      .mutateAsync(itemPuntual.trim())
      .then(() => true)
      .catch(() => false);

    if (bomOk && lotesOk) {
      setResultadoItemPuntual({ ok: true, mensaje: `${itemPuntual.trim()} actualizado: receta, atributos, stock y lotes.` });
    } else if (bomOk && !lotesOk) {
      setResultadoItemPuntual({ ok: false, mensaje: 'Receta y atributos actualizados, pero falló la parte de stock/lotes.' });
    } else if (!bomOk && lotesOk) {
      setResultadoItemPuntual({ ok: false, mensaje: 'Stock y lotes actualizados, pero falló la parte de receta/atributos.' });
    } else {
      setResultadoItemPuntual({ ok: false, mensaje: 'No se pudo actualizar el producto. Verifica el código e intenta de nuevo.' });
    }
  };

  const itemPuntualPendiente =
    sincronizarBOMMutation.isPending || sincronizarLotesItemMutation.isPending;

  const errorInventarioMensaje = (sincronizarInventarioMutation.error as any)?.response?.status === 409
    ? 'Ya hay una sincronización de inventario/lotes en curso. Intenta nuevamente en unos minutos.'
    : 'Error al sincronizar inventario. Verifica la conexión con SAP.';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sincronizar con SAP</h1>
        <p className="text-gray-600">
          Trae la información desde SAP Business One hacia Orbit. Usa los botones en este orden
          cada mañana: <strong>1 → 2 → 4</strong>. El <strong>3</strong> es solo para corregir un
          producto puntual cuando algo quedó mal.
        </p>
      </div>

      {/* 1. BOM completo */}
      <Card title="1. Recetas y Atributos — todos los productos">
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Trae de SAP, para <strong>todos</strong> los productos: la receta (ingredientes y
            cantidades), tipo de masa, tamaño, forma, y qué ingredientes son de decoración.
            <br />
            <span className="text-amber-700 font-medium">
              Ejecútalo antes del primer día de producción, y de nuevo cuando en SAP se cree un
              producto nuevo o se modifique una receta o un atributo.
            </span>
          </p>

          <Button
            variant="success"
            isLoading={sincronizarBOMMutation.isPending && !itemPuntual.trim()}
            disabled={algunaSincronizacionActiva}
            onClick={handleSyncBOM}
          >
            {sincronizarBOMMutation.isPending && !itemPuntual.trim() ? 'Sincronizando...' : 'Sincronizar BOM completo'}
          </Button>

          {sincronizarBOMMutation.isSuccess && sincronizarBOMMutation.data && !itemPuntual.trim() && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 font-medium">✓ BOM sincronizado correctamente</p>
              <ul className="mt-2 text-sm text-green-700 space-y-1">
                <li>· {sincronizarBOMMutation.data.articulos_procesados} artículos procesados</li>
                <li>· {sincronizarBOMMutation.data.bom_sincronizados} con lista de materiales</li>
                <li>· {sincronizarBOMMutation.data.sin_bom} sin BOM en SAP</li>
              </ul>
              {sincronizarBOMMutation.data.errores && sincronizarBOMMutation.data.errores.length > 0 && (
                <p className="mt-2 text-sm text-amber-700">
                  ⚠ {sincronizarBOMMutation.data.errores.length} artículo(s) con error al procesar
                </p>
              )}
            </div>
          )}

          {sincronizarBOMMutation.isError && !itemPuntual.trim() && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">✗ Error al sincronizar BOM. Verifica la conexión con SAP.</p>
            </div>
          )}
        </div>
      </Card>

      {/* 2. Inventario y Lotes completo */}
      <Card title="2. Inventario y Lotes — todas las materias primas">
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Trae de SAP cuánto stock hay, a qué costo, y qué lotes están disponibles, para
            <strong> todas</strong> las materias primas de las recetas.
            <br />
            <span className="text-amber-700 font-medium">
              Ejecútalo cada mañana, después del paso 1, antes de empezar a producir.
              Puede tardar entre 10 y 15 minutos — no cierres esta pestaña mientras corre.
            </span>
          </p>

          <Button
            variant="primary"
            isLoading={sincronizarInventarioMutation.isPending}
            disabled={algunaSincronizacionActiva}
            onClick={handleSyncInventario}
          >
            {sincronizarInventarioMutation.isPending
              ? `Sincronizando... (${formatearTiempo(segundosTranscurridos)})`
              : 'Sincronizar Inventario y Lotes'}
          </Button>

          {sincronizarInventarioMutation.isSuccess && sincronizarInventarioMutation.data && (
            <ul className="mt-2 text-sm text-green-700 space-y-0.5">
              <li>✓ {sincronizarInventarioMutation.data.sincronizados} materias primas sincronizadas</li>
              <li>✓ {sincronizarInventarioMutation.data.lotes_sincronizados} lotes sincronizados</li>
            </ul>
          )}
          {sincronizarInventarioMutation.isError && (
            <p className="mt-2 text-sm text-red-800">✗ {errorInventarioMensaje}</p>
          )}
        </div>
      </Card>

      {/* 3. Producto puntual — un solo botón, todo incluido */}
      <Card title="3. Corregir un producto puntual">
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Escribe el código SAP de un producto que quedó mal o se creó/corrigió en SAP después
            de la última corrida completa. Actualiza receta, atributos, stock y lotes de ese
            producto, todo de una vez.
          </p>

          <div className="flex gap-2 flex-wrap items-start">
            <input
              type="text"
              value={itemPuntual}
              onChange={(e) => setItemPuntual(e.target.value)}
              placeholder="Ej: PEPR13"
              disabled={algunaSincronizacionActiva}
              className="border border-gray-300 rounded-lg px-4 py-2 flex-1 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <Button
              variant="secondary"
              isLoading={itemPuntualPendiente}
              disabled={algunaSincronizacionActiva || !itemPuntual.trim()}
              onClick={handleSyncItemPuntual}
            >
              {itemPuntualPendiente
                ? `Sincronizando... (${formatearTiempo(segundosTranscurridos)})`
                : 'Sincronizar producto'}
            </Button>
          </div>

          {resultadoItemPuntual && (
            <div className={`p-3 rounded-lg text-sm ${resultadoItemPuntual.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
              {resultadoItemPuntual.ok ? '✓ ' : '⚠ '}{resultadoItemPuntual.mensaje}
            </div>
          )}
        </div>
      </Card>

      {/* 4. Órdenes de Venta del día */}
      <Card title="4. Órdenes de Venta del día">
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Trae las Órdenes de Venta abiertas en SAP para la fecha elegida, las agrupa por tipo de
            masa, y crea las masas del día en <strong>Planificación</strong>, listas para producir.
            <br />
            <span className="text-amber-700 font-medium">Ejecútalo cada día, después de los pasos 1 y 2.</span>
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fecha de producción
            </label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={forzar}
              onChange={(e) => setForzar(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <span>
              Forzar re-sincronización{' '}
              <span className="text-gray-500">(re-crea masas en Planificación, preserva las que están en producción)</span>
            </span>
          </label>

          <Button
            variant="primary"
            isLoading={sincronizarOVMutation.isPending}
            disabled={algunaSincronizacionActiva}
            onClick={handleSyncOV}
          >
            {sincronizarOVMutation.isPending ? 'Sincronizando...' : 'Sincronizar Órdenes de Venta'}
          </Button>

          {sincronizarOVMutation.isSuccess && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800">✓ Órdenes sincronizadas. Ve a Planificación para continuar.</p>
            </div>
          )}

          {sincronizarOVMutation.isError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">✗ Error al sincronizar órdenes. Intenta nuevamente.</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default SincronizarSAP;

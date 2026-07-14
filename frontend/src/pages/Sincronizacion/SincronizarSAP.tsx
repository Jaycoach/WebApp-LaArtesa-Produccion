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
  const [itemsPuntual, setItemsPuntual] = useState<string>('');
  const [segundosTranscurridos, setSegundosTranscurridos] = useState<number>(0);

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

  const handleSyncBOMPuntual = async () => {
    if (!itemsPuntual.trim()) return;
    try {
      await sincronizarBOMMutation.mutateAsync(itemsPuntual.trim());
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

  const handleSyncLotesItem = async () => {
    if (!itemsPuntual.trim()) return;
    try {
      await sincronizarLotesItemMutation.mutateAsync(itemsPuntual.trim());
    } catch {
      // error manejado por isError
    }
  };

  const errorInventarioMensaje = (sincronizarInventarioMutation.error as any)?.response?.status === 409
    ? 'Ya hay una sincronización de inventario/lotes en curso. Intenta nuevamente en unos minutos.'
    : 'Error al sincronizar inventario. Verifica la conexión con SAP.';

  const errorLotesItemMensaje = (sincronizarLotesItemMutation.error as any)?.response?.status === 409
    ? 'Ya hay una sincronización de inventario/lotes en curso. Intenta nuevamente en unos minutos.'
    : 'Error al sincronizar los códigos especificados.';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sincronizar con SAP</h1>
        <p className="text-gray-600">
          Trae la información maestra y las órdenes del día desde SAP Business One hacia Orbit.
          Sigue el orden de los pasos de arriba hacia abajo.
        </p>
      </div>

      {/* Paso 1: BOM */}
      <Card title="Paso 1 — Recetas y Atributos de Productos (BOM)">
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Trae desde SAP, para <strong>todos los productos</strong>: la receta (ingredientes y cantidades),
            el tipo de masa, tamaño, forma, si algún ingrediente es de decoración, y el peso máximo de división.
            Deja todo listo en Orbit para que Planificación pueda armar las masas del día.
            <br />
            <span className="text-amber-700 font-medium">
              Ejecútalo antes del primer día de producción, y de nuevo cada vez que en SAP se cree un producto
              nuevo o se modifique una receta / un atributo (tamaño, forma, decoración, etc.).
            </span>
          </p>

          <Button
            variant="success"
            isLoading={sincronizarBOMMutation.isPending}
            disabled={algunaSincronizacionActiva}
            onClick={handleSyncBOM}
          >
            {sincronizarBOMMutation.isPending ? 'Sincronizando BOM...' : 'Sincronizar BOM'}
          </Button>

          {sincronizarBOMMutation.isSuccess && sincronizarBOMMutation.data && !sincronizarBOMMutation.variables && (
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

          {sincronizarBOMMutation.isError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">✗ Error al sincronizar BOM. Verifica la conexión con SAP.</p>
            </div>
          )}
        </div>
      </Card>

      {/* Sincronizar Inventario MP */}
      <div className="border rounded-lg p-4 bg-white space-y-4">
        <div>
          <h3 className="font-semibold text-gray-800 mb-1">Inventario y Lotes — Bodega ALMP (materias primas)</h3>
          <p className="text-sm text-gray-500 mb-3">
            Trae desde SAP cuánto stock hay, a qué costo, y qué lotes están disponibles para cada materia prima.
            Ejecútalo al inicio de cada día, después del Paso 1, para que Pesaje tenga el inventario al día.
          </p>

          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
            <p className="text-sm font-medium text-gray-800 mb-1">🔄 Sincronizar todo el inventario</p>
            <p className="text-xs text-gray-500 mb-3">
              Actualiza stock, costo y lotes de <strong>todas</strong> las materias primas usadas en las recetas.
              <strong> Puede tardar entre 10 y 15 minutos</strong> porque consulta SAP una por una — no recargues
              la página ni cierres esta pestaña mientras se procesa.
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
            {sincronizarInventarioMutation.isPending && (
              <p className="mt-2 text-xs text-amber-700">
                ⏳ Este proceso consulta SAP ítem por ítem y puede tomar varios minutos. La página seguirá funcionando, espera el mensaje de confirmación.
              </p>
            )}
          </div>

          {sincronizarInventarioMutation.isSuccess && sincronizarInventarioMutation.data && (
            <ul className="mt-3 text-sm text-green-700 space-y-0.5">
              <li>✓ {sincronizarInventarioMutation.data.sincronizados} materias primas sincronizadas</li>
              <li>✓ {sincronizarInventarioMutation.data.lotes_sincronizados} lotes sincronizados</li>
            </ul>
          )}
          {sincronizarInventarioMutation.isError && (
            <p className="mt-2 text-sm text-red-800">✗ {errorInventarioMensaje}</p>
          )}
        </div>

        <div className="border-t border-gray-200 pt-4">
          <p className="text-sm font-medium text-gray-800 mb-1">🎯 Sincronizar solo un producto puntual</p>
          <p className="text-xs text-gray-500 mb-3">
            Escribe uno o más códigos SAP (separados por coma) cuando un producto quedó mal o no se
            sincronizó en la corrida completa. Elige qué necesitas actualizar de ese producto — puedes
            usar los dos botones si necesitas ambas cosas.
          </p>
          <input
            type="text"
            value={itemsPuntual}
            onChange={(e) => setItemsPuntual(e.target.value)}
            placeholder="Ej: MP0029,MP0080"
            disabled={algunaSincronizacionActiva}
            className="border border-gray-300 rounded-lg px-4 py-2 w-full mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <div className="flex gap-2 flex-wrap items-start">
            <Button
              variant="success"
              isLoading={sincronizarBOMMutation.isPending}
              disabled={algunaSincronizacionActiva || !itemsPuntual.trim()}
              onClick={handleSyncBOMPuntual}
            >
              {sincronizarBOMMutation.isPending ? 'Sincronizando...' : 'Actualizar receta y atributos'}
            </Button>
            <Button
              variant="secondary"
              isLoading={sincronizarLotesItemMutation.isPending}
              disabled={algunaSincronizacionActiva || !itemsPuntual.trim()}
              onClick={handleSyncLotesItem}
            >
              {sincronizarLotesItemMutation.isPending
                ? `Sincronizando... (${formatearTiempo(segundosTranscurridos)})`
                : 'Actualizar stock y lotes'}
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            <strong>Receta y atributos</strong>: recetas, tipo de masa, tamaño, forma y decoración —
            lo mismo que el Paso 1 pero solo para estos códigos. <strong>Stock y lotes</strong>: cantidad
            disponible, costo y lotes — lo mismo que "Sincronizar todo el inventario" pero puntual.
          </p>

          {sincronizarBOMMutation.isSuccess && sincronizarBOMMutation.data && sincronizarBOMMutation.variables && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
              <p className="text-green-700">
                ✓ Sincronización puntual completada: {sincronizarBOMMutation.data.bom_sincronizados} de{' '}
                {itemsPuntual.split(',').map(c => c.trim()).filter(Boolean).length} código(s)
              </p>
              {(sincronizarBOMMutation.data.item_codes_no_encontrados?.length ?? 0) > 0 && (
                <p className="text-amber-700 text-xs mt-1">
                  ⚠ No encontrados en SAP con tipo de masa configurado: {sincronizarBOMMutation.data.item_codes_no_encontrados!.join(', ')}
                </p>
              )}
            </div>
          )}

          {sincronizarLotesItemMutation.isSuccess && sincronizarLotesItemMutation.data && (
            <div className="mt-3 text-sm space-y-1">
              <p className="text-green-700">
                ✓ {sincronizarLotesItemMutation.data.lotesSincronizados} lotes sincronizados
                para {sincronizarLotesItemMutation.data.itemCodesProcesados.length} ítem(s)
              </p>
              {Object.entries(sincronizarLotesItemMutation.data.detallePorItem).map(([code, cantidad]) => (
                <p key={code} className="text-gray-600 text-xs ml-4">· {code}: {cantidad} lote(s)</p>
              ))}
              {sincronizarLotesItemMutation.data.itemCodesSinLotesEncontrados.length > 0 && (
                <p className="text-amber-700 text-xs">
                  ⚠ Sin lotes en SAP: {sincronizarLotesItemMutation.data.itemCodesSinLotesEncontrados.join(', ')}
                </p>
              )}
              {sincronizarLotesItemMutation.data.itemCodesSinBatch.length > 0 && (
                <p className="text-amber-700 text-xs">
                  ⚠ No manejan lotes en SAP: {sincronizarLotesItemMutation.data.itemCodesSinBatch.join(', ')}
                </p>
              )}
              {sincronizarLotesItemMutation.data.itemCodesInvalidos.length > 0 && (
                <p className="text-red-700 text-xs">
                  ✗ No encontrados en BOM/recetas: {sincronizarLotesItemMutation.data.itemCodesInvalidos.join(', ')}
                </p>
              )}
            </div>
          )}
          {sincronizarLotesItemMutation.isError && (
            <p className="mt-2 text-sm text-red-800">✗ {errorLotesItemMensaje}</p>
          )}
        </div>
      </div>

      {/* Paso 2: Órdenes de Venta */}
      <Card title="Paso 2 — Órdenes de Venta del día">
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Trae las Órdenes de Venta abiertas en SAP para la fecha elegida, las agrupa por tipo de masa
            y crea las masas del día en <strong>Planificación</strong>, listas para empezar a producir.
            Ejecútalo cada día, después del Paso 1 y de Inventario y Lotes.
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

      {/* Orden de operación */}
      <Card title="¿En qué orden hago esto?">
        <ol className="space-y-3 text-sm text-gray-700 list-decimal list-inside">
          <li>
            <strong>Paso 1 — Recetas y Atributos:</strong> una vez, o cuando SAP tenga productos
            nuevos o recetas/atributos modificados.
          </li>
          <li>
            <strong>Inventario y Lotes:</strong> cada mañana, antes de empezar a producir.
          </li>
          <li>
            <strong>Paso 2 — Órdenes de Venta:</strong> cada día, para traer las masas de hoy.
          </li>
          <li>
            Ir a <strong>Planificación</strong> → abrir cada masa → completar la fase Planificación
            → los ingredientes se generan solos desde la receta.
          </li>
          <li>
            Seguir el proceso normal: <strong>Pesaje → Amasado → División → Formado → Fermentación → Horneado → Empaque</strong>.
          </li>
        </ol>
      </Card>
    </div>
  );
};

export default SincronizarSAP;

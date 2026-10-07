import React from 'react';
import clsx from 'clsx';

interface AvisoInformativoProps {
  titulo: string;
  children: React.ReactNode;
  /** Si se pasa, se muestra el botón y se llama al pulsarlo. */
  onEntendido?: () => void;
  textoBoton?: string;
  className?: string;
}

/**
 * Tarjeta informativa destacada (azul, ícono de información, título en negrita). Pensada para avisos que
 * NO son un error de la aplicación (sesión cerrada, contraseña temporal, etc.): no usa el rojo ni el
 * amarillo del aviso de "nueva versión". Se lee bien a 390 px: el botón ocupa todo el ancho en celular.
 */
export const AvisoInformativo: React.FC<AvisoInformativoProps> = ({
  titulo,
  children,
  onEntendido,
  textoBoton = 'Entendido',
  className,
}) => (
  <div
    role="status"
    className={clsx('rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm', className)}
  >
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600" aria-hidden="true">
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold text-blue-900">{titulo}</h2>
        <div className="mt-1 text-sm leading-relaxed text-blue-900/90 break-words">{children}</div>
      </div>
    </div>
    {onEntendido && (
      <button
        type="button"
        onClick={onEntendido}
        className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:ml-auto sm:block sm:w-auto"
      >
        {textoBoton}
      </button>
    )}
  </div>
);

export default AvisoInformativo;

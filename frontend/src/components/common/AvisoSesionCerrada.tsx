import React from 'react';
import { AvisoInformativo } from './AvisoInformativo';
import { contenidoAviso, type AvisoSesion } from '@/utils/avisoSesion';

interface AvisoSesionCerradaProps {
  aviso: AvisoSesion;
  onEntendido: () => void;
}

/** Aviso de sesión cerrada de la pantalla de login (texto según el motivo; usuario en negrita). */
export const AvisoSesionCerrada: React.FC<AvisoSesionCerradaProps> = ({ aviso, onEntendido }) => {
  const { titulo, fragmentos } = contenidoAviso(aviso);
  return (
    <AvisoInformativo titulo={titulo} onEntendido={onEntendido}>
      <p>
        {fragmentos.map((f, i) => (f.negrita ? <strong key={i} className="font-bold">{f.texto}</strong> : <span key={i}>{f.texto}</span>))}
      </p>
    </AvisoInformativo>
  );
};

export default AvisoSesionCerrada;

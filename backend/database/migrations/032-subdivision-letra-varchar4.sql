-- Migración 032: ampliar subdivision_letra de VARCHAR(1) a VARCHAR(4)
-- Permite letras dobles (AA, AB... AJ) para masas que superan 26 tandas
-- Causa raíz: masas > 2340 kg generaban nTandas > 26 y el INSERT fallaba silenciosamente

ALTER TABLE masas_produccion
  ALTER COLUMN subdivision_letra TYPE VARCHAR(4);

COMMENT ON COLUMN masas_produccion.subdivision_letra IS
  'Letra(s) de tanda: A–Z para ≤26 tandas, AA–ZZ para ≤702 tandas';

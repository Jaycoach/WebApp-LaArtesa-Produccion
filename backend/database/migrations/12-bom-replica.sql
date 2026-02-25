-- =====================================================
-- Migración 12: Réplica local de artículos y BOM SAP
-- Tablas: sap_articulos, sap_bom_componentes
-- =====================================================

-- Tabla 1: Réplica de Items SAP con U_JZ_Tipos_Masa
CREATE TABLE IF NOT EXISTS sap_articulos (
    item_code           VARCHAR(50)     PRIMARY KEY,
    item_name           VARCHAR(200)    NOT NULL,
    tipo_masa           VARCHAR(100),
    sales_qty_per_pack  NUMERIC(10,4)   DEFAULT 1,
    gramaje             NUMERIC(10,4)   DEFAULT 0,
    activo              BOOLEAN         DEFAULT true,
    synced_at           TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    created_at          TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sap_articulos_tipo_masa ON sap_articulos(tipo_masa);
CREATE INDEX IF NOT EXISTS idx_sap_articulos_activo    ON sap_articulos(activo);

COMMENT ON TABLE sap_articulos IS
  'Réplica local de Items SAP con U_JZ_Tipos_Masa. Se actualiza via POST /api/sap/sincronizar-bom.';

-- Tabla 2: Réplica de ProductTreeLines SAP
CREATE TABLE IF NOT EXISTS sap_bom_componentes (
    id                  SERIAL          PRIMARY KEY,
    item_code_padre     VARCHAR(50)     NOT NULL,
    item_code_comp      VARCHAR(50)     NOT NULL,
    item_name_comp      VARCHAR(200)    NOT NULL,
    cantidad            NUMERIC(14,6)   NOT NULL,
    warehouse           VARCHAR(20),
    issue_method        VARCHAR(30),
    visual_order        INTEGER         DEFAULT 0,
    synced_at           TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    created_at          TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (item_code_padre, item_code_comp)
);

CREATE INDEX IF NOT EXISTS idx_bom_padre ON sap_bom_componentes(item_code_padre);
CREATE INDEX IF NOT EXISTS idx_bom_comp  ON sap_bom_componentes(item_code_comp);

COMMENT ON TABLE sap_bom_componentes IS
  'Réplica local de ProductTreeLines SAP. Una fila por componente de cada producto terminado.';
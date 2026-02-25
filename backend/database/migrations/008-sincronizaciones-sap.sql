-- =============================================
-- MIGRACIÓN 008: Tabla de log de sincronizaciones SAP
-- Sistema ARTESA - La Artesa SAS
-- Fecha: 2026-02-24
-- Descripción: Tabla de registro detallado de cada
--   sincronización ejecutada desde Órdenes de Venta SAP.
--   Complementa sap_sync_log con campos específicos de OV.
-- =============================================

BEGIN;

CREATE TABLE IF NOT EXISTS sincronizaciones_sap (
  id                   SERIAL PRIMARY KEY,
  fecha_sync           TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_produccion     DATE NOT NULL,
  masas_creadas        INTEGER DEFAULT 0,
  productos_procesados INTEGER DEFAULT 0,
  estado               VARCHAR(20) NOT NULL DEFAULT 'EXITOSO'
                         CHECK (estado IN ('EXITOSO', 'ERROR', 'PARCIAL')),
  error_mensaje        TEXT,
  created_at           TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE sincronizaciones_sap IS 'Registro de sincronizaciones ejecutadas desde Órdenes de Venta SAP';
COMMENT ON COLUMN sincronizaciones_sap.fecha_produccion IS 'Fecha de DocDate de las OV sincronizadas';
COMMENT ON COLUMN sincronizaciones_sap.masas_creadas IS 'Número de masas_produccion creadas o actualizadas';
COMMENT ON COLUMN sincronizaciones_sap.productos_procesados IS 'Líneas de OV procesadas (suma de todas las masas)';

CREATE INDEX IF NOT EXISTS idx_sync_sap_fecha_produccion
  ON sincronizaciones_sap(fecha_produccion);

CREATE INDEX IF NOT EXISTS idx_sync_sap_created_at
  ON sincronizaciones_sap(created_at DESC);

-- =============================================
-- VERIFICACIÓN FINAL
-- =============================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'sincronizaciones_sap'
  ) THEN
    RAISE NOTICE '✓ Tabla sincronizaciones_sap creada correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se creó la tabla sincronizaciones_sap';
  END IF;
END $$;

COMMIT;

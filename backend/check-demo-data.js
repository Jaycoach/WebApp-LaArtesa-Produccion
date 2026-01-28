/**
 * Script para verificar datos de demo
 */

const { Pool } = require('pg');
require('dotenv').config();
const config = require('./src/config');

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

async function checkDemoData() {
  const client = await pool.connect();

  try {
    console.log('\n📊 ESTADO ACTUAL DE LA BASE DE DATOS\n');
    console.log('='.repeat(70));

    // Masas
    const masasQuery = `
      SELECT
        id, codigo_masa, tipo_masa, nombre_masa, estado, fase_actual,
        total_kilos_con_merma as kilos
      FROM masas_produccion
      ORDER BY id
    `;
    const masas = await client.query(masasQuery);

    console.log(`\n🎯 MASAS DE PRODUCCIÓN (${masas.rows.length}):`);
    masas.rows.forEach(masa => {
      console.log(`   ID ${masa.id}: ${masa.codigo_masa}`);
      console.log(`      Tipo: ${masa.tipo_masa} - ${masa.nombre_masa}`);
      console.log(`      Estado: ${masa.estado} | Fase: ${masa.fase_actual}`);
      console.log(`      Kilos: ${masa.kilos}`);
      console.log('');
    });

    // Progreso de fases por masa
    for (const masa of masas.rows) {
      const fasesQuery = `
        SELECT fase, estado, porcentaje_completado
        FROM progreso_fases
        WHERE masa_id = $1
        ORDER BY
          CASE fase
            WHEN 'PESAJE' THEN 1
            WHEN 'AMASADO' THEN 2
            WHEN 'DIVISION' THEN 3
            WHEN 'FORMADO' THEN 4
            WHEN 'FERMENTACION' THEN 5
            WHEN 'HORNEADO' THEN 6
          END
      `;
      const fases = await client.query(fasesQuery, [masa.id]);

      console.log(`   📋 Progreso de ${masa.codigo_masa}:`);
      fases.rows.forEach(fase => {
        const emoji = fase.estado === 'COMPLETADA' ? '✅' :
                      fase.estado === 'EN_PROGRESO' ? '🔄' : '🔒';
        console.log(`      ${emoji} ${fase.fase}: ${fase.estado} (${fase.porcentaje_completado}%)`);
      });
      console.log('');
    }

    // Productos
    const productosQuery = `
      SELECT COUNT(*) as count
      FROM productos_por_masa
    `;
    const productos = await client.query(productosQuery);
    console.log(`\n📦 PRODUCTOS: ${productos.rows[0].count}`);

    // Ingredientes
    const ingredientesQuery = `
      SELECT COUNT(*) as count
      FROM ingredientes_masa
    `;
    const ingredientes = await client.query(ingredientesQuery);
    console.log(`🌾 INGREDIENTES: ${ingredientes.rows[0].count}`);

    console.log('\n' + '='.repeat(70));
    console.log('\n✨ Estado de la base de datos verificado\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

checkDemoData()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  });

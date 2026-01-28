/**
 * Script para cargar datos de demostración en la base de datos
 * Ejecutar con: node load-demo-data.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Cargar variables de entorno
require('dotenv').config();

const config = require('./src/config');

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

async function loadDemoData() {
  const client = await pool.connect();

  try {
    console.log('🔍 Verificando datos existentes...');

    // Verificar si ya hay masas
    const checkQuery = 'SELECT COUNT(*) as count FROM masas_produccion';
    const result = await client.query(checkQuery);
    const count = parseInt(result.rows[0].count);

    if (count > 0) {
      console.log(`⚠️  Ya existen ${count} masas en la base de datos.`);
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        readline.question('¿Desea borrar y recargar los datos? (si/no): ', resolve);
      });
      readline.close();

      if (answer.toLowerCase() !== 'si' && answer.toLowerCase() !== 's') {
        console.log('❌ Operación cancelada');
        return;
      }
    }

    console.log('📥 Cargando datos de demostración...');

    // Leer y ejecutar el script SQL
    const sqlPath = path.join(__dirname, 'seed_simple.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query(sql);

    console.log('✅ Datos de demostración cargados exitosamente');

    // Mostrar resumen
    const masasResult = await client.query('SELECT COUNT(*) FROM masas_produccion');
    const productosResult = await client.query('SELECT COUNT(*) FROM productos_por_masa');
    const ingredientesResult = await client.query('SELECT COUNT(*) FROM ingredientes_masa');

    console.log('\n📊 Resumen de datos cargados:');
    console.log(`   - Masas: ${masasResult.rows[0].count}`);
    console.log(`   - Productos: ${productosResult.rows[0].count}`);
    console.log(`   - Ingredientes: ${ingredientesResult.rows[0].count}`);

    // Mostrar las masas creadas
    const masasQuery = `
      SELECT id, codigo_masa, tipo_masa, nombre_masa, estado, fase_actual
      FROM masas_produccion
      ORDER BY id
    `;
    const masas = await client.query(masasQuery);

    console.log('\n📋 Masas disponibles para la demo:');
    masas.rows.forEach(masa => {
      console.log(`   ${masa.id}. ${masa.codigo_masa} - ${masa.nombre_masa}`);
      console.log(`      Estado: ${masa.estado} | Fase: ${masa.fase_actual}`);
    });

  } catch (error) {
    console.error('❌ Error al cargar datos:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecutar
loadDemoData()
  .then(() => {
    console.log('\n✨ Proceso completado');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  });

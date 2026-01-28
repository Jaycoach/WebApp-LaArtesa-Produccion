/**
 * Script para generar hashes de contraseñas y actualizar usuarios
 * Este script genera los hashes correctos de bcrypt para las contraseñas
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

// Configuración de la base de datos
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// Usuarios con sus contraseñas
const usuarios = [
  { username: 'admin', password: 'Admin123!@#', nombre_completo: 'Administrador del Sistema', rol: 'ADMIN', email: 'admin@artesa.com' },
  { username: 'supervisor1', password: 'Test123!@#', nombre_completo: 'Juan Supervisor', rol: 'SUPERVISOR', email: 'supervisor@artesa.com' },
  { username: 'operario1', password: 'Test123!@#', nombre_completo: 'Pedro Operario', rol: 'OPERARIO', email: 'operario1@artesa.com' },
  { username: 'operario2', password: 'Test123!@#', nombre_completo: 'María González', rol: 'OPERARIO', email: 'operario2@artesa.com' },
  { username: 'calidad1', password: 'Test123!@#', nombre_completo: 'Ana Calidad', rol: 'CALIDAD', email: 'calidad@artesa.com' },
  { username: 'demo', password: 'Demo123@', nombre_completo: 'Usuario Demo', rol: 'OPERARIO', email: 'demo@artesa.com' }
];

async function generarYActualizarPasswords() {
  const client = await pool.connect();

  try {
    console.log('🔐 Generando hashes de contraseñas...\n');

    for (const usuario of usuarios) {
      console.log(`Procesando usuario: ${usuario.username}`);

      // Generar hash
      const hash = await bcrypt.hash(usuario.password, 12);
      console.log(`  Password: ${usuario.password}`);
      console.log(`  Hash: ${hash}`);

      // Verificar si el usuario existe
      const checkResult = await client.query(
        'SELECT id FROM usuarios WHERE username = $1',
        [usuario.username]
      );

      if (checkResult.rows.length > 0) {
        // Actualizar usuario existente
        await client.query(
          `UPDATE usuarios
           SET password_hash = $1,
               email = $2,
               nombre_completo = $3,
               rol = $4,
               activo = true,
               email_verificado = true
           WHERE username = $5`,
          [hash, usuario.email, usuario.nombre_completo, usuario.rol, usuario.username]
        );
        console.log(`  ✓ Usuario actualizado\n`);
      } else {
        // Crear nuevo usuario
        await client.query(
          `INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado)
           VALUES ($1, $2, $3, $4, $5, true, true)`,
          [usuario.username, usuario.email, hash, usuario.nombre_completo, usuario.rol]
        );
        console.log(`  ✓ Usuario creado\n`);
      }

      // Verificar que el hash funciona
      const isValid = await bcrypt.compare(usuario.password, hash);
      if (!isValid) {
        console.error(`  ❌ ERROR: La verificación falló para ${usuario.username}`);
      }
    }

    console.log('✅ Todos los usuarios han sido actualizados correctamente');
    console.log('\nCredenciales de acceso:');
    console.log('========================');
    usuarios.forEach(u => {
      console.log(`Username: ${u.username.padEnd(15)} | Password: ${u.password}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecutar
generarYActualizarPasswords();

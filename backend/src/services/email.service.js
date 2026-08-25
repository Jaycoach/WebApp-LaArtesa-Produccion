/**
 * Servicio de Email — AWS SES vía SMTP
 * Reutiliza credenciales SMTP del usuario IAM artesa-smtp-user
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Transporter SMTP apuntando a SES us-east-1
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: false, // STARTTLS en puerto 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  pool: true,
  maxConnections: 3,
  rateLimit: parseInt(process.env.SES_RATE_LIMIT, 10) || 14, // msgs/segundo SES
});

/**
 * Verificar conexión SMTP al iniciar (no bloquea el servidor si falla)
 */
const verifyConnection = async () => {
  try {
    await transporter.verify();
    logger.info('✅ Conexión SMTP con AWS SES verificada');
  } catch (err) {
    logger.warn(`⚠️  SMTP no disponible: ${err.message} — emails desactivados`);
  }
};

// Verificar en background al cargar el módulo
verifyConnection();

/**
 * Enviar email genérico (base para todos los demás)
 */
const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn('SMTP no configurado — email omitido', { to, subject });
    return { skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: `"La Artesa Panadería" <${process.env.SMTP_FROM || 'noreply@artesapanaderia.com'}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''), // fallback texto plano
    });

    logger.info('Email enviado', { to, subject, messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error('Error enviando email', { to, subject, error: err.message });
    throw new Error(`Error de email: ${err.message}`);
  }
};

/**
 * Email de verificación de cuenta
 * Se envía al registrar un nuevo usuario
 */
const sendVerificationEmail = async ({ to, nombre, token }) => {
  const baseUrl = process.env.APP_URL || `http://${process.env.HOST || 'localhost'}`;
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#F5F0E4;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E4;padding:40px 0;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <!-- Header -->
            <tr>
              <td style="background:#dc2626;padding:32px 40px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                  🍞 La Artesa Panadería
                </h1>
                <p style="margin:8px 0 0;color:#fecaca;font-size:14px;">Sistema de Control de Producción</p>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:40px;">
                <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;">Hola, ${nombre} 👋</h2>
                <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                  Tu cuenta ha sido creada en el sistema de producción de La Artesa.
                  Para activarla y poder iniciar sesión, confirma tu dirección de correo:
                </p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td align="center" style="padding:8px 0 32px;">
                    <a href="${verifyUrl}"
                       style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;
                              padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                      Verificar mi correo
                    </a>
                  </td></tr>
                </table>
                <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">
                  O copia este enlace en tu navegador:
                </p>
                <p style="margin:0 0 24px;word-break:break-all;">
                  <a href="${verifyUrl}" style="color:#dc2626;font-size:13px;">${verifyUrl}</a>
                </p>
                <hr style="border:none;border-top:1px solid #f1f5f9;margin:0 0 24px;">
                <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.5;">
                  Este enlace expira en <strong>24 horas</strong>.<br>
                  Si no solicitaste esta cuenta, ignora este correo.
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background:#f8fafc;padding:20px 40px;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;">
                  © ${new Date().getFullYear()} La Artesa SAS — Bogotá, Colombia
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({ to, subject: '✅ Verifica tu correo — La Artesa Producción', html });
};

/**
 * Email de recuperación de contraseña
 * Reemplaza el TODO en forgotPassword
 */
const sendPasswordResetEmail = async ({ to, nombre, token }) => {
  const baseUrl = process.env.APP_URL || `http://${process.env.HOST || 'localhost'}`;
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#F5F0E4;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E4;padding:40px 0;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#dc2626;padding:32px 40px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">
                  🍞 La Artesa Panadería
                </h1>
                <p style="margin:8px 0 0;color:#fecaca;font-size:14px;">Sistema de Control de Producción</p>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;">Hola, ${nombre} 👋</h2>
                <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                  Recibimos una solicitud para restablecer la contraseña de tu cuenta.
                  Si fuiste tú, haz clic en el botón:
                </p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td align="center" style="padding:8px 0 32px;">
                    <a href="${resetUrl}"
                       style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;
                              padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                      Restablecer contraseña
                    </a>
                  </td></tr>
                </table>
                <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">
                  O copia este enlace en tu navegador:
                </p>
                <p style="margin:0 0 24px;word-break:break-all;">
                  <a href="${resetUrl}" style="color:#dc2626;font-size:13px;">${resetUrl}</a>
                </p>
                <hr style="border:none;border-top:1px solid #f1f5f9;margin:0 0 24px;">
                <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.5;">
                  Este enlace expira en <strong>1 hora</strong>.<br>
                  Si no solicitaste este cambio, ignora este correo — tu contraseña no cambiará.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:20px 40px;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;">
                  © ${new Date().getFullYear()} La Artesa SAS — Bogotá, Colombia
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({ to, subject: '🔐 Recuperación de contraseña — La Artesa Producción', html });
};

/**
 * Email de notificación al completar pesaje
 * Se envía a correos_empaque al confirmar pesaje exitosamente
 */
const sendPesajeCompletadoEmail = async ({ to, masa }) => {
  const fechaStr = typeof masa.fecha_produccion === 'string'
    ? masa.fecha_produccion.slice(0, 10)
    : masa.fecha_produccion.toISOString().slice(0, 10);
  const fecha = new Date(`${fechaStr}T12:00:00`).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#F5F0E4;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E4;padding:40px 0;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#dc2626;padding:32px 40px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                  🍞 La Artesa Panadería
                </h1>
                <p style="margin:8px 0 0;color:#fecaca;font-size:14px;">Sistema de Control de Producción</p>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="margin:0 0 8px;color:#1e293b;font-size:20px;">✅ Pesaje completado</h2>
                <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                  Se ha confirmado el pesaje de la siguiente masa. El área de producción puede continuar con el amasado.
                </p>
                <table width="100%" cellpadding="0" cellspacing="0"
                       style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:24px;">
                  <tr>
                    <td style="padding:20px;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding:6px 0;color:#64748b;font-size:13px;width:140px;">Código masa</td>
                          <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${masa.codigo_masa}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#64748b;font-size:13px;">Tipo</td>
                          <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${masa.tipo_masa}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#64748b;font-size:13px;">Fecha producción</td>
                          <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${fecha}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#64748b;font-size:13px;">Total kilos</td>
                          <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${parseFloat(masa.total_kilos_con_merma).toFixed(1)} kg</td>
                        </tr>
                        ${masa.lote_produccion ? `
                        <tr>
                          <td style="padding:6px 0;color:#64748b;font-size:13px;">Lote</td>
                          <td style="padding:6px 0;color:#dc2626;font-size:13px;font-weight:700;">${masa.lote_produccion}</td>
                        </tr>` : ''}
                        ${masa.es_repeticion ? `
                        <tr>
                          <td colspan="2" style="padding:8px 0 0;">
                            <span style="background:#fef2f2;color:#dc2626;font-size:12px;font-weight:600;padding:4px 10px;border-radius:4px;">🔁 REPETICIÓN</span>
                          </td>
                        </tr>` : ''}
                      </table>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
                  La masa pasará a la fase de <strong>Amasado</strong>. Coordine con el equipo de producción.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:20px 40px;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;">
                  © ${new Date().getFullYear()} La Artesa SAS — Bogotá, Colombia
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({
    to,
    subject: `✅ Pesaje completado — ${masa.tipo_masa} (${masa.codigo_masa})`,
    html,
  });
};

/**
 * Email de notificación al APROBAR masa — solo materiales de empaque
 * Se envía a correos_empaque inmediatamente al aprobar la masa
 */
const sendAprobacionMasaEmail = async ({ to, masa, productosEmpaque }) => {
  const fechaStr = typeof masa.fecha_produccion === 'string'
    ? masa.fecha_produccion.slice(0, 10)
    : masa.fecha_produccion.toISOString().slice(0, 10);
  const fecha = new Date(`${fechaStr}T12:00:00`).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  // Migración 068: lote(s) simulado(s) al aprobar (masa.lotes), en vez de
  // codigo_masa — Empaque necesita el lote real de producción, no el código
  // interno de la masa. Fallback a codigo_masa si por algún motivo no hay
  // lotes (p.ej. la masa no tenía productos aptos con BOM al aprobar).
  const lotesStr = (masa.lotes && masa.lotes.length > 0)
    ? masa.lotes.join(', ')
    : masa.codigo_masa;

  const filasEmpaque = productosEmpaque.map(p => `
    <tr>
      <td style="padding:8px 12px;color:#1e293b;font-size:13px;border-bottom:1px solid #f1f5f9;">${p.item_code}</td>
      <td style="padding:8px 12px;color:#1e293b;font-size:13px;border-bottom:1px solid #f1f5f9;">${p.item_name}</td>
      <td style="padding:8px 12px;color:#1e293b;font-size:13px;border-bottom:1px solid #f1f5f9;text-align:right;">${parseFloat(p.cantidad_total).toFixed(0)}</td>
      <td style="padding:8px 12px;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;text-align:center;">${p.uom || 'UN'}</td>
    </tr>`).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#F5F0E4;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E4;padding:40px 0;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#dc2626;padding:32px 40px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">🍞 La Artesa Panadería</h1>
                <p style="margin:8px 0 0;color:#fecaca;font-size:14px;">Sistema de Control de Producción</p>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="margin:0 0 8px;color:#1e293b;font-size:20px;">📦 Alistamiento de empaque requerido</h2>
                <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                  Se ha aprobado una masa de producción. Por favor aliste los siguientes materiales de empaque.
                </p>
                <table width="100%" cellpadding="0" cellspacing="0"
                       style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:24px;">
                  <tr><td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;width:140px;">Lote${masa.lotes && masa.lotes.length > 1 ? 's' : ''}</td>
                        <td style="padding:6px 0;color:#dc2626;font-size:13px;font-weight:700;">${lotesStr}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;">Tipo</td>
                        <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${masa.tipo_masa}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;">Fecha producción</td>
                        <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${fecha}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;">Total paquetes</td>
                        <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${masa.total_paquetes} paq</td>
                      </tr>
                    </table>
                  </td></tr>
                </table>
                <p style="margin:0 0 12px;color:#1e293b;font-size:14px;font-weight:600;">Materiales de empaque a alistar:</p>
                <table width="100%" cellpadding="0" cellspacing="0"
                       style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:24px;">
                  <thead>
                    <tr style="background:#f1f5f9;">
                      <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Código</th>
                      <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Material</th>
                      <th style="padding:10px 12px;text-align:right;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Cantidad</th>
                      <th style="padding:10px 12px;text-align:center;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">UOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filasEmpaque || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#94a3b8;font-size:13px;">Sin materiales de empaque registrados</td></tr>'}
                  </tbody>
                </table>
                <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.5;">
                  Este aviso se generó automáticamente al aprobar la masa en el sistema de producción.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:20px 40px;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} La Artesa SAS — Bogotá, Colombia</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({
    to,
    subject: `📦 Alistamiento empaque — ${masa.tipo_masa} (${lotesStr}) · ${fecha}`,
    html,
  });
};

/**
 * Correo de aviso a Empaque cuando cambia el plan de lotes de una masa ya
 * aprobada (edición de delta que hace crecer/reducir el kg total y cambia si
 * hace falta subdividir, o en cuántas tandas). Se envía solo cuando la
 * estructura de lotes simulada realmente cambió (masas.controller.js decide
 * eso comparando el plan anterior con el nuevo antes de llamar aquí).
 */
const sendLoteActualizadoEmail = async ({ to, masa, lotesAnteriores, lotesNuevos }) => {
  const fechaStr = typeof masa.fecha_produccion === 'string'
    ? masa.fecha_produccion.slice(0, 10)
    : masa.fecha_produccion.toISOString().slice(0, 10);
  const fecha = new Date(`${fechaStr}T12:00:00`).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#F5F0E4;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E4;padding:40px 0;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#dc2626;padding:32px 40px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">🍞 La Artesa Panadería</h1>
                <p style="margin:8px 0 0;color:#fecaca;font-size:14px;">Sistema de Control de Producción</p>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="margin:0 0 8px;color:#1e293b;font-size:20px;">⚠️ Lote actualizado</h2>
                <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                  Se editó la cantidad de esta masa después de aprobarla y el plan de lote(s) cambió.
                  Si ya alistó materiales de empaque con el lote anterior, revíselos.
                </p>
                <table width="100%" cellpadding="0" cellspacing="0"
                       style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:24px;">
                  <tr><td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;width:140px;">Código masa</td>
                        <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${masa.codigo_masa}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;">Tipo</td>
                        <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${masa.tipo_masa}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;">Fecha producción</td>
                        <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;">${fecha}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;">Lote(s) anterior(es)</td>
                        <td style="padding:6px 0;color:#94a3b8;font-size:13px;font-weight:600;text-decoration:line-through;">${lotesAnteriores.join(', ') || '—'}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#64748b;font-size:13px;">Lote(s) nuevo(s)</td>
                        <td style="padding:6px 0;color:#dc2626;font-size:13px;font-weight:700;">${lotesNuevos.join(', ') || '—'}</td>
                      </tr>
                    </table>
                  </td></tr>
                </table>
                <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.5;">
                  Este aviso se generó automáticamente al detectar el cambio en el sistema de producción.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:20px 40px;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} La Artesa SAS — Bogotá, Colombia</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({
    to,
    subject: `⚠️ Lote actualizado — ${masa.tipo_masa} (${masa.codigo_masa}) · ${fecha}`,
    html,
  });
};

/**
 * Correo RESUMEN de aprobación masiva — una sola notificación por lote en
 * vez de un correo por masa (evita spam a Empaque y uso excesivo de SES).
 */
const sendAprobacionMasaBulkEmail = async ({ to, masas }) => {
  const filas = masas.map(m => `
    <tr>
      <td style="padding:8px 12px;color:#1e293b;font-size:13px;border-bottom:1px solid #f1f5f9;">${m.codigo_masa}</td>
      <td style="padding:8px 12px;color:#1e293b;font-size:13px;border-bottom:1px solid #f1f5f9;">${m.tipo_masa}</td>
      <td style="padding:8px 12px;color:#1e293b;font-size:13px;border-bottom:1px solid #f1f5f9;text-align:right;">${m.total_paquetes} paq</td>
    </tr>`).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#F5F0E4;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E4;padding:40px 0;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#dc2626;padding:32px 40px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">🍞 La Artesa Panadería</h1>
                <p style="margin:8px 0 0;color:#fecaca;font-size:14px;">Sistema de Control de Producción</p>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="margin:0 0 8px;color:#1e293b;font-size:20px;">📦 Alistamiento de empaque requerido — ${masas.length} masa${masas.length !== 1 ? 's' : ''} aprobada${masas.length !== 1 ? 's' : ''}</h2>
                <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                  Se aprobaron ${masas.length} masas de producción en un solo lote. Revisa el detalle de materiales de cada una en Orbit.
                </p>
                <table width="100%" cellpadding="0" cellspacing="0"
                       style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:24px;">
                  <thead>
                    <tr style="background:#f1f5f9;">
                      <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Código masa</th>
                      <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Tipo</th>
                      <th style="padding:10px 12px;text-align:right;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Paquetes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filas}
                  </tbody>
                </table>
                <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.5;">
                  Este aviso se generó automáticamente al aprobar el lote en el sistema de producción.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:20px 40px;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} La Artesa SAS — Bogotá, Colombia</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({
    to,
    subject: `📦 Alistamiento empaque — ${masas.length} masas aprobadas`,
    html,
  });
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPesajeCompletadoEmail,
  sendAprobacionMasaEmail,
  sendLoteActualizadoEmail,
  sendAprobacionMasaBulkEmail,
};

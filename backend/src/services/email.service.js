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
  const verifyUrl = `${baseUrl}/verificar-email?token=${token}`;

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

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
};

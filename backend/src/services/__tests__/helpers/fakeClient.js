/**
 * Cliente de BD falso para pruebas unitarias de servicios.
 *
 * `handlers` es una lista de [regex, respuesta|fn]; la primera que coincida con
 * el SQL responde (por defecto: { rows: [], rowCount: 0 }). Todas las consultas
 * quedan registradas, con el SQL normalizado a una línea, en `calls`.
 */
function fakeClient(handlers = []) {
  const calls = [];
  return {
    calls,
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      for (const [re, res] of handlers) {
        if (re.test(sql)) return typeof res === 'function' ? res(sql, params) : res;
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

/** Consultas registradas cuyo SQL coincide con `re`. */
const sqlDe = (client, re) => client.calls.filter((c) => re.test(c.sql));

module.exports = { fakeClient, sqlDe };

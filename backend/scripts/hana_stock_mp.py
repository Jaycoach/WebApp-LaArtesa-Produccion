async getStockMateriaPrima(itemCodes) {
    if (!itemCodes || itemCodes.length === 0) return {};

    if (process.env.SAP_READ_MODE === 'hana') {
      return this._getStockMateriaPrimaHANA(itemCodes);
    }

    await this.ensureSession();

    const resultado = {};

    for (const itemCode of itemCodes) {
      try {
        const response = await this.client.get(
          `/Items('${itemCode}')?$select=ItemCode,ItemName,MovingAveragePrice,InventoryUOM,ManageBatchNumbers,ItemWarehouseInfoCollection`
        );

        const item       = response.data;
        const bodegaAlmp = (item.ItemWarehouseInfoCollection || [])
          .find(b => b.WarehouseCode === 'ALMP');

        resultado[itemCode] = {
          itemCode:             item.ItemCode,
          itemName:             item.ItemName,
          uom:                  item.InventoryUOM,
          manageBatchNumbers:   item.ManageBatchNumbers === 'tYES',
          costoPromedio:        bodegaAlmp?.StandardAveragePrice || item.MovingAveragePrice || 0,
          stockAlmp:            bodegaAlmp?.InStock      || 0,
          committedAlmp:        bodegaAlmp?.Committed    || 0,
          orderedAlmp:          bodegaAlmp?.Ordered      || 0,
        };
      } catch (error) {
        logger.warn(`SAP: no se pudo obtener stock para ${itemCode}: ${error.message}`);
        resultado[itemCode] = null;
      }
    }

    logger.info(`SAP: stock obtenido para ${Object.keys(resultado).length} ítems`);
    return resultado;
  }

  /**
   * Extrae stock de materia prima directo de HANA vía script Python (hdbcli).
   * Reemplaza las N llamadas secuenciales a /Items('{itemCode}') (Service Layer)
   * por una sola consulta consolidada OITW+OITM. Mismo shape de retorno.
   */
  async _getStockMateriaPrimaHANA(itemCodes) {
    const { execFile } = require('child_process');
    const path = require('path');

    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '../../scripts/hana_stock_mp.py');
      const child = execFile('python3', [scriptPath], {
        timeout: 30000,
        env: process.env,
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`HANA stock: error ejecutando script Python: ${error.message}. stderr: ${stderr}`);
          return resolve(Object.fromEntries(itemCodes.map(c => [c, null])));
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) {
            logger.error(`HANA stock: error reportado por script: ${parsed.error}`);
            return resolve(Object.fromEntries(itemCodes.map(c => [c, null])));
          }
          const stock = parsed.stock;
          for (const itemCode of itemCodes) {
            if (!(itemCode in stock)) stock[itemCode] = null;
          }
          logger.info(`HANA stock: obtenido para ${Object.keys(parsed.stock).length}/${itemCodes.length} ítems vía HANA directo`);
          resolve(stock);
        } catch (parseErr) {
          logger.error(`HANA stock: respuesta no parseable: ${parseErr.message}. stdout: ${stdout}`);
          resolve(Object.fromEntries(itemCodes.map(c => [c, null])));
        }
      });
      child.stdin.write(JSON.stringify(itemCodes));
      child.stdin.end();
    });
  }
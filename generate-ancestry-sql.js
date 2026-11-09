/**
 * Genera un archivo .sql con el query de CategoryAncestry para las categorías
 * del CSV de entrada (categorías a ingresar, no existentes en Loolu).
 *
 * Toma del CSV: fiMerchantId (col 0) y fiCategoryId (col 1).
 * Genera una tabla temporal Ambito con esos IDs y ejecuta el INSERT tal cual
 * el query original, sustituyendo solo el contenido de Ambito.
 *
 * Uso:
 *   node generate-ancestry-sql.js <csv-diff> [merchant-id]
 *
 * Ejemplo:
 *   node generate-ancestry-sql.js CategoriasElSalvador_051126_VTEX_noEnLoolu.csv 5
 *
 * Salida (en el mismo directorio del CSV):
 *   <base>_CategoryAncestry.sql
 */

const fs = require('fs');
const path = require('path');

// --- Parseo de argumentos ---
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('Uso: node generate-ancestry-sql.js <csv-diff> [merchant-id]');
  console.log('');
  console.log('  csv-diff    Archivo .csv con las categorías a ingresar (las que no están en Loolu)');
  console.log('  merchant-id ID del merchant (opcional, se infiere del CSV si se omite)');
  console.log('');
  console.log('Ejemplo:');
  console.log('  node generate-ancestry-sql.js CategoriasElSalvador_051126_VTEX_noEnLoolu.csv 5');
  process.exit(0);
}

const CSV_FILE = path.resolve(args[0]);
const DIR = path.dirname(CSV_FILE);
const BASE_NAME = path.basename(CSV_FILE, '.csv');
const OUTPUT_SQL = path.join(DIR, BASE_NAME + '_CategoryAncestry.sql');

let MERCHANT_ID = args.length >= 2 ? parseInt(args[1], 10) : null;

// --- Parser CSV ---
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  while (i < content.length) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') { field += '"'; i += 2; }
        else { inQuotes = false; i++; }
      } else { field += char; i++; }
    } else {
      if (char === '"') { inQuotes = true; i++; }
      else if (char === ',') { row.push(field); field = ''; i++; }
      else if (char === '\n' || char === '\r') {
        row.push(field); field = ''; rows.push(row); row = [];
        if (char === '\r' && content[i + 1] === '\n') i += 2; else i++;
      } else { field += char; i++; }
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// --- Ejecución principal ---

try {
  if (!fs.existsSync(CSV_FILE)) throw new Error('No se encontró: ' + path.basename(CSV_FILE));

  console.log('Leyendo CSV: ' + path.basename(CSV_FILE));

  const raw = fs.readFileSync(CSV_FILE, 'utf8');
  const rows = parseCsv(raw);
  const dataRows = rows.slice(1); // saltar encabezado

  // Inferir merchant ID del primer registro si no se proporcionó
  if (MERCHANT_ID === null) {
    if (dataRows.length > 0 && dataRows[0].length > 0) {
      MERCHANT_ID = parseInt(dataRows[0][0], 10) || 5;
    } else {
      MERCHANT_ID = 5;
    }
    console.log('  Merchant ID inferido: ' + MERCHANT_ID);
  }

  // Extraer fiCategoryId (columna 1) de cada fila
  const categoryIds = [];
  for (const fields of dataRows) {
    if (fields.length > 1) {
      const catId = parseInt(fields[1], 10);
      if (!isNaN(catId)) {
        categoryIds.push(catId);
      }
    }
  }

  console.log('  Categorías a ingresar: ' + categoryIds.length);

  if (categoryIds.length === 0) {
    console.log('\nNo hay categorías. No se genera archivo SQL.');
    process.exit(0);
  }

  // --- Generar SQL ---

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let sql = '';

  // Encabezado
  sql += '-- ============================================================\n';
  sql += '-- CategoryAncestry - Categorías nuevas (VTEX no en Loolu)\n';
  sql += '-- Merchant ID: ' + MERCHANT_ID + '\n';
  sql += '-- Generado: ' + now + '\n';
  sql += '-- Categorías: ' + categoryIds.length + '\n';
  sql += '-- Fuente: ' + path.basename(CSV_FILE) + '\n';
  sql += '-- ============================================================\n\n';

  // Tabla temporal Ambito con los IDs del CSV
  sql += '-- Tabla temporal con las categorías del ámbito (categorías nuevas a ingresar)\n';
  sql += 'CREATE TEMPORARY TABLE Ambito (\n';
  sql += '  fiCategoryId INT\n';
  sql += ');\n\n';

  sql += 'INSERT INTO Ambito (fiCategoryId) VALUES\n';
  const valueLines = categoryIds.map(function (id) {
    return '  (' + id + ')';
  });
  sql += valueLines.join(',\n') + ';\n\n';

  // SET @MERCHANT_ID
  sql += 'SET @MERCHANT_ID = ' + MERCHANT_ID + ';\n\n';

  // Query original tal cual lo proporcionó el usuario
  sql += '-- Eliminar ancestria previa dentro del ámbito\n';
  sql += 'DELETE ca\n';
  sql += 'FROM CategoryAncestry ca\n';
  sql += 'JOIN Ambito amb ON amb.fiCategoryId = ca.fiCategoryId\n';
  sql += 'WHERE ca.fiMerchantId = @MERCHANT_ID;\n\n';

  sql += '-- Insertar los 5 niveles leyendo la jerarquia directa de la tabla principal para las categorias del ambito\n';
  sql += 'INSERT INTO CategoryAncestry (fiMerchantId, fiCategoryId, fiCategoryAncestry, fiOrder)\n';
  sql += 'SELECT\n';
  sql += '   @MERCHANT_ID AS fiMerchantId,\n';
  sql += '   cat.fiCategoryId AS fiCategoryId,\n';
  sql += '   CASE n.fiOrder\n';
  sql += '       WHEN 5 THEN cat.fiCategoryId -- Nivel 5: Ella misma\n';
  sql += '       WHEN 4 THEN COALESCE(cat.fiFatherCategoryId, 0) -- Nivel 4: Padre\n';
  sql += '       WHEN 3 THEN COALESCE(padre.fiFatherCategoryId, 0) -- Nivel 3: Abuelo\n';
  sql += '       WHEN 2 THEN COALESCE(abuelo.fiFatherCategoryId, 0) -- Nivel 2: Bisabuelo\n';
  sql += '       WHEN 1 THEN COALESCE(bisabuelo.fiFatherCategoryId, 0) -- Nivel 1: Tatarabuelo\n';
  sql += '   END AS fiCategoryAncestry,\n';
  sql += '   n.fiOrder\n';
  sql += 'FROM StyrkPrincipalCategoriesCatalog cat\n';
  sql += 'JOIN Ambito amb ON amb.fiCategoryId = cat.fiCategoryId\n';
  sql += 'CROSS JOIN (\n';
  sql += '   SELECT 1 AS fiOrder\n';
  sql += '   UNION ALL SELECT 2\n';
  sql += '   UNION ALL SELECT 3\n';
  sql += '   UNION ALL SELECT 4\n';
  sql += '   UNION ALL SELECT 5\n';
  sql += ') n\n';
  sql += 'LEFT JOIN StyrkPrincipalCategoriesCatalog padre ON padre.fiMerchantId = @MERCHANT_ID AND padre.fiCategoryId = cat.fiFatherCategoryId\n';
  sql += 'LEFT JOIN StyrkPrincipalCategoriesCatalog abuelo ON abuelo.fiMerchantId = @MERCHANT_ID AND abuelo.fiCategoryId = padre.fiFatherCategoryId\n';
  sql += 'LEFT JOIN StyrkPrincipalCategoriesCatalog bisabuelo ON bisabuelo.fiMerchantId = @MERCHANT_ID AND bisabuelo.fiCategoryId = abuelo.fiFatherCategoryId\n';
  sql += 'WHERE cat.fiMerchantId = @MERCHANT_ID\n';
  sql += 'ON DUPLICATE KEY UPDATE fiOrder = VALUES(fiOrder);\n\n';

  // Limpieza
  sql += '-- Limpiar tabla temporal\n';
  sql += 'DROP TEMPORARY TABLE Ambito;\n';

  fs.writeFileSync(OUTPUT_SQL, '\ufeff' + sql, 'utf8');

  console.log('\n  ✔ SQL generado: ' + path.basename(OUTPUT_SQL));
  console.log('    ' + categoryIds.length + ' categorías en la tabla temporal Ambito');
  console.log('\nListo.');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

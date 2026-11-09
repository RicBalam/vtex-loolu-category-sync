/**
 * Script que:
 *  1. Lee un JSON de categorías de VTEX y lo convierte a un CSV con el mismo
 *     esquema y formato de la tabla de categorías de Loolu (Styrk).
 *  2. Compara el CSV recién generado (VTEX en formato Loolu) contra un CSV
 *     existente de Loolu y genera un nuevo CSV con las categorías que están en
 *     VTEX pero NO en Loolu.
 *
 * La comparación se hace por fiVtexCategoryId (el ID de la categoría en VTEX).
 *
 * Uso:
 *   node vtex-to-loolu-compare.js <json-vtex> <csv-loolu> [merchant-id]
 *
 * Ejemplo:
 *   node vtex-to-loolu-compare.js CategoriasElSalvador_051126.json StyrkPrincipalCategoriesCatalog_202611051224_SQL.csv 5
 *   node vtex-to-loolu-compare.js merchant2_nicaragua.json StyrkNicaragua.csv 2
 *
 * Salidas (se generan en el mismo directorio del JSON):
 *   <base>_VTEX_LooluFormat.csv     -> JSON de VTEX en formato Loolu
 *   <base>_VTEX_noEnLoolu.csv        -> Categorías en VTEX pero no en Loolu
 *
 * Solo usa módulos nativos de Node, no requiere npm install.
 */

const fs = require('fs');
const path = require('path');

// --- Parseo de argumentos ---
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Uso: node vtex-to-loolu-compare.js <json-vtex> <csv-loolu> [merchant-id]');
  console.log('');
  console.log('  json-vtex    Archivo .json con el árbol de categorías de VTEX');
  console.log('  csv-loolu    Archivo .csv con el catálogo actual de Loolu (Styrk)');
  console.log('  merchant-id  ID del merchant (opcional, por defecto se infiere del CSV)');
  console.log('');
  console.log('Ejemplo:');
  console.log('  node vtex-to-loolu-compare.js CategoriasElSalvador_051126.json StyrkPrincipalCategoriesCatalog_202611051224_SQL.csv 5');
  process.exit(0);
}

const JSON_FILE = path.resolve(args[0]);
const LOOLU_CSV = path.resolve(args[1]);
const DIR = path.dirname(JSON_FILE);
const BASE_NAME = path.basename(JSON_FILE, '.json');

// Archivos de salida
const VTEX_CSV = path.join(DIR, BASE_NAME + '_VTEX_LooluFormat.csv');
const DIFF_CSV = path.join(DIR, BASE_NAME + '_VTEX_noEnLoolu.csv');

// Merchant ID: argumento opcional, o se infiere del primer registro del CSV de Loolu
let MERCHANT_ID = args.length >= 3 ? parseInt(args[2], 10) : null;

// Esquema exacto de la tabla de Loolu (mismo orden que el CSV existente)
const HEADERS = [
  'fiMerchantId',
  'fiCategoryId',
  'fiFatherCategoryId',
  'fiChildrenCategoryId',
  'fcName',
  'fcTitle',
  'fcDescription',
  'fcAdWordsRemarketingCode',
  'fiShowInStoreFront',
  'fiIsActive',
  'fiActiveStoreFrontLink',
  'fiShowBrandFilter',
  'fiHasChildren',
  'fiScore',
  'fcStockKeepingUnitSelectionMode',
  'fdDateInsert',
  'fdDateUpdate',
  'fcErpCategoryId',
  'fcErpParentCategoryId',
  'fiVtexCategoryId',
  'fbItSent',
  'fiMasterMerchantId',
  'fiMasterCategoryId',
];

// Índice de fiVtexCategoryId dentro de HEADERS (para la comparación)
const VTEX_ID_INDEX = HEADERS.indexOf('fiVtexCategoryId'); // 19

// --- Utilidades CSV ---

/**
 * Escapa un valor para CSV (RFC 4180).
 * Envuelve entre comillas dobles si contiene comas, comillas o saltos de línea.
 */
function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Parsea un texto CSV completo en un arreglo de filas (arreglos de strings).
 * Maneja campos entre comillas que pueden contener comas, comillas dobles
 * escapadas y saltos de línea embebidos.
 */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Eliminar BOM si existe
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  while (i < content.length) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        // Comilla doble escapada
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (char === '\n' || char === '\r') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        // Saltar \r\n o \n o \r suelto
        if (char === '\r' && content[i + 1] === '\n') i += 2;
        else i++;
      } else {
        field += char;
        i++;
      }
    }
  }
  // Último campo/fila
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Convierte un objeto fila a una línea CSV usando HEADERS.
 */
function rowToCsvLine(row) {
  return HEADERS.map((h) => escapeCsv(row[h])).join(',');
}

// --- Paso 1: JSON de VTEX → CSV en formato Loolu ---

/**
 * Recorre el árbol de categorías de VTEX (DFS) y construye filas en formato Loolu.
 * @param {Array} nodes - arreglo raíz del JSON o sub-arreglo children
 * @param {number} fatherId - ID del padre (0 para raíz)
 * @param {Array} rows - acumulador de filas
 */
function flattenVtexTree(nodes, fatherId, rows) {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    const hasChildren = node.hasChildren ? 1 : 0;

    rows.push({
      fiMerchantId: MERCHANT_ID,
      fiCategoryId: node.id,
      fiFatherCategoryId: fatherId,
      fiChildrenCategoryId: 0,
      fcName: node.name || '',
      fcTitle: node.Title || node.name || '',
      fcDescription: node.MetaTagDescription || '',
      fcAdWordsRemarketingCode: '',
      fiShowInStoreFront: 1,
      fiIsActive: 1,
      fiActiveStoreFrontLink: 1,
      fiShowBrandFilter: 0,
      fiHasChildren: hasChildren,
      fiScore: 0,
      fcStockKeepingUnitSelectionMode: '',
      fdDateInsert: '',
      fdDateUpdate: '',
      fcErpCategoryId: '',
      fcErpParentCategoryId: '',
      fiVtexCategoryId: node.id,
      fbItSent: 1,
      fiMasterMerchantId: 0,
      fiMasterCategoryId: 0,
    });

    if (node.children && node.children.length > 0) {
      flattenVtexTree(node.children, node.id, rows);
    }
  }
}

function generateVtexLooluCsv() {
  console.log('Paso 1: Convirtiendo JSON de VTEX a formato CSV de Loolu...\n');

  const raw = fs.readFileSync(JSON_FILE, 'utf8');
  const data = JSON.parse(raw);

  // Fecha actual en formato "YYYY-MM-DD HH:mm:ss"
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const rows = [];
  flattenVtexTree(data, 0, rows);

  // Asignar fechas a todas las filas
  for (const row of rows) {
    row.fdDateInsert = now;
    row.fdDateUpdate = now;
  }

  // Construir CSV
  const headerLine = HEADERS.map((h) => '"' + h + '"').join(',');
  const lines = [headerLine];
  for (const row of rows) {
    lines.push(rowToCsvLine(row));
  }

  fs.writeFileSync(VTEX_CSV, '\ufeff' + lines.join('\n') + '\n', 'utf8');

  console.log('  ✔ JSON leído: ' + path.basename(JSON_FILE));
  console.log('  ✔ CSV generado: ' + path.basename(VTEX_CSV) + ' (' + rows.length + ' filas)');
  console.log('');

  return rows;
}

// --- Paso 2: Comparar VTEX vs Loolu ---

function compareWithLoolu(vtexRows) {
  console.log('Paso 2: Comparando VTEX vs Loolu...\n');

  // Leer CSV existente de Loolu
  const looluRaw = fs.readFileSync(LOOLU_CSV, 'utf8');
  const looluRows = parseCsv(looluRaw);

  // La primera fila es el encabezado; descartarla
  const looluDataRows = looluRows.slice(1);

  // Extraer los fiVtexCategoryId existentes en Loolu
  const looluVtexIds = new Set();
  for (const fields of looluDataRows) {
    if (fields.length > VTEX_ID_INDEX) {
      const vtexId = fields[VTEX_ID_INDEX].trim();
      if (vtexId !== '') {
        looluVtexIds.add(vtexId);
      }
    }
  }

  console.log('  Categorías en Loolu (CSV existente): ' + looluVtexIds.size);
  console.log('  Categorías en VTEX (JSON):           ' + vtexRows.length);

  // Encontrar categorías que están en VTEX pero no en Loolu
  const diffRows = [];
  for (const row of vtexRows) {
    if (!looluVtexIds.has(String(row.fiVtexCategoryId))) {
      diffRows.push(row);
    }
  }

  console.log('  Categorías en VTEX pero NO en Loolu:   ' + diffRows.length + '\n');

  // Escribir CSV de diferencias
  if (diffRows.length > 0) {
    const headerLine = HEADERS.map((h) => '"' + h + '"').join(',');
    const lines = [headerLine];
    for (const row of diffRows) {
      lines.push(rowToCsvLine(row));
    }
    fs.writeFileSync(DIFF_CSV, '\ufeff' + lines.join('\n') + '\n', 'utf8');
    console.log('  ✔ CSV generado: ' + path.basename(DIFF_CSV) + ' (' + diffRows.length + ' filas)\n');

    // Mostrar ejemplos
    console.log('  Ejemplos de categorías faltantes:');
    const ejemplos = Math.min(15, diffRows.length);
    for (let i = 0; i < ejemplos; i++) {
      const r = diffRows[i];
      console.log(
        '    VtexId=' + r.fiVtexCategoryId +
        '  Padre=' + r.fiFatherCategoryId +
        '  ' + r.fcName
      );
    }
    if (diffRows.length > ejemplos) {
      console.log('    ... y ' + (diffRows.length - ejemplos) + ' más');
    }
  } else {
    console.log('  No hay categorías faltantes. Todas las categorías de VTEX ya están en Loolu.');
  }

  console.log('\nListo.');
}

// --- Ejecución principal ---

try {
  if (!fs.existsSync(JSON_FILE)) throw new Error('No se encontró: ' + path.basename(JSON_FILE));
  if (!fs.existsSync(LOOLU_CSV)) throw new Error('No se encontró: ' + path.basename(LOOLU_CSV));

  // Si no se proporcionó merchant-id, inferirlo del primer registro del CSV de Loolu
  if (MERCHANT_ID === null) {
    const looluRaw = fs.readFileSync(LOOLU_CSV, 'utf8');
    const looluRows = parseCsv(looluRaw);
    if (looluRows.length > 1 && looluRows[1].length > 0) {
      MERCHANT_ID = parseInt(looluRows[1][0], 10) || 5;
    } else {
      MERCHANT_ID = 5;
    }
    console.log('Merchant ID inferido del CSV de Loolu: ' + MERCHANT_ID + '\n');
  }

  const vtexRows = generateVtexLooluCsv();
  compareWithLoolu(vtexRows);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

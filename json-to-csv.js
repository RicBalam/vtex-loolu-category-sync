/**
 * Script que lee todos los archivos .json del directorio y genera archivos
 * de salida a partir de la jerarquía anidada de categorías.
 *
 * Opciones:
 *   --csv   Genera un archivo .csv por cada .json (aplanando la jerarquía)
 *   --sql   Genera un archivo .sql con sentencias INSERT por cada .json
 *   --all   Genera tanto CSV como SQL
 *   (sin opciones, genera CSV por defecto)
 *
 * Uso:
 *   node json-to-csv.js                    -> CSV en el directorio del script
 *   node json-to-csv.js --sql               -> SQL en el directorio del script
 *   node json-to-csv.js --all "C:\ruta"     -> CSV + SQL en el directorio indicado
 *
 * Solo usa módulos nativos de Node, no requiere npm install.
 */

const fs = require('fs');
const path = require('path');

// --- Parseo de argumentos ---

const args = process.argv.slice(2);
let dir = __dirname;
const opts = { csv: false, sql: false };

for (const arg of args) {
  if (arg === '--csv') opts.csv = true;
  else if (arg === '--sql') opts.sql = true;
  else if (arg === '--all') { opts.csv = true; opts.sql = true; }
  else if (!arg.startsWith('--')) dir = path.resolve(arg);
}

// Si no se indicó ninguna opción, CSV es el comportamiento por defecto.
if (!opts.csv && !opts.sql) opts.csv = true;

// --- Funciones de aplanamiento (CSV) ---

/**
 * Aplana el árbol de categorías en una lista de filas planas (DFS).
 * Cada fila incluye la ruta jerárquica completa (breadcrumb) hasta esa categoría.
 *
 * @param {Array} nodes    - arreglo raíz del JSON (o sub-arreglo children)
 * @param {Array} ancestors - nombres de las categorías ancestro (ruta parcial)
 * @param {number} level   - nivel de profundidad (1 = raíz)
 * @param {Array} rows     - acumulador de filas resultantes
 */
function flatten(nodes, ancestors, level, rows) {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    const currentPath = [...ancestors, node.name];
    const parentPath = ancestors.join(' > ');

    rows.push({
      id: node.id,
      name: node.name,
      level: level,
      parentPath: parentPath,
      fullPath: currentPath.join(' > '),
      hasChildren: node.hasChildren,
      url: node.url,
      Title: node.Title,
      MetaTagDescription: node.MetaTagDescription,
    });

    if (node.children && node.children.length > 0) {
      flatten(node.children, currentPath, level + 1, rows);
    }
  }
}

/**
 * Escapa un valor para incluirlo de forma segura en CSV (RFC 4180).
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
 * Convierte un arreglo de objetos (filas) en texto CSV.
 */
function rowsToCsv(rows) {
  const headers = [
    'id',
    'name',
    'level',
    'parentPath',
    'fullPath',
    'hasChildren',
    'url',
    'Title',
    'MetaTagDescription',
  ];

  const lines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map((h) => escapeCsv(row[h]));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

// --- Funciones de SQL ---

/**
 * Quita acentos y diacríticos de un texto (ñ -> n, á -> a, é -> e, etc.).
 */
function stripAccents(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Recorre el árbol en orden por niveles (BFS) y construye las filas SQL.
 * fatherId = id del padre, o 0 para categorías raíz.
 *
 * @param {Array} rootNodes - arreglo raíz del JSON
 * @returns {Array} filas con { id, fatherId, name }
 */
function flattenSql(rootNodes) {
  const rows = [];
  const queue = [];

  // Encolar todos los nodos raíz con fatherId = 0.
  for (const node of rootNodes) {
    queue.push({ node, fatherId: 0 });
  }

  while (queue.length > 0) {
    const { node, fatherId } = queue.shift();

    rows.push({
      id: node.id,
      fatherId: fatherId,
      name: stripAccents(node.name),
    });

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        queue.push({ node: child, fatherId: node.id });
      }
    }
  }

  return rows;
}

/**
 * Genera el texto SQL con la sentencia INSERT formateada.
 *
 * Formato:
 *   INSERT INTO VtexReal (VtexId, VtexFatherId, VtexName) VALUES
 *                                                             (id, fatherId, 'name'),
 *                                                             ...
 *                                                             (id, fatherId, 'name');
 */
function rowsToSql(rows) {
  const header = 'INSERT INTO VtexReal (VtexId, VtexFatherId, VtexName) VALUES';
  const indent = ' '.repeat(58);

  const lines = rows.map((row, i) => {
    // Escapar comillas simples duplicándolas (estándar SQL).
    const safeName = row.name.replace(/'/g, "''");
    const ending = i === rows.length - 1 ? ';' : ',';
    return `${indent}(${row.id}, ${row.fatherId}, '${safeName}')${ending}`;
  });

  return header + '\n' + lines.join('\n') + '\n';
}

// --- Procesamiento por archivo ---

/**
 * Procesa un archivo JSON según las opciones activas (CSV y/o SQL).
 */
function processJsonFile(jsonPath) {
  const baseName = path.basename(jsonPath, '.json');
  const outDir = path.dirname(jsonPath);

  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);

    if (opts.csv) {
      const rows = [];
      flatten(data, [], 1, rows);
      const csv = rowsToCsv(rows);
      const csvPath = path.join(outDir, baseName + '.csv');
      fs.writeFileSync(csvPath, '\ufeff' + csv, 'utf8'); // BOM para Excel
      console.log(`✔ ${path.basename(jsonPath)} -> ${baseName}.csv (${rows.length} filas)`);
    }

    if (opts.sql) {
      const rows = flattenSql(data);
      const sql = rowsToSql(rows);
      const sqlPath = path.join(outDir, baseName + '.sql');
      fs.writeFileSync(sqlPath, '\ufeff' + sql, 'utf8');
      console.log(`✔ ${path.basename(jsonPath)} -> ${baseName}.sql (${rows.length} filas)`);
    }
  } catch (err) {
    console.error(`✖ Error procesando ${path.basename(jsonPath)}: ${err.message}`);
  }
}

// --- Ejecución principal ---

const jsonFiles = fs
  .readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.json'))
  .map((f) => path.join(dir, f));

if (jsonFiles.length === 0) {
  console.log('No se encontraron archivos .json en: ' + dir);
  process.exit(0);
}

const tasks = [];
if (opts.csv) tasks.push('CSV');
if (opts.sql) tasks.push('SQL');

console.log(`Procesando ${jsonFiles.length} archivo(s) .json en: ${dir}`);
console.log(`Salidas: ${tasks.join(' + ')}\n`);

for (const file of jsonFiles) {
  processJsonFile(file);
}

console.log('\nListo.');

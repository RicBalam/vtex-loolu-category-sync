# Scripts VTEX → Loolu

Conjunto de scripts en Node.js para convertir y comparar árboles de categorías entre VTEX y la base de datos de Loolu (Styrk). No requieren instalación de dependencias, solo Node.js.

---

## Requisitos

- **Node.js** v14 o superior
- No se necesitan `npm install` ni librerías externas (todos los scripts usan módulos nativos)

---

## Scripts

### 1. `json-to-csv.js` — Convertir JSON de VTEX a CSV

Convierte los archivos `.json` del árbol de categorías de VTEX en archivos `.csv` aplanando la jerarquía. Genera además archivos `.sql` con sentencias `INSERT` en formato Loolu.

```bash
# Generar CSV de todos los .json del directorio
node json-to-csv.js

# Generar solo SQL INSERT
node json-to-csv.js --sql

# Generar CSV + SQL
node json-to-csv.js --all

# Especificar otro directorio
node json-to-csv.js --all "C:\ruta\a\jsons"
```

**Salida:** un `.csv` (y/o `.sql`) por cada `.json` encontrado.

---

### 2. `vtex-to-loolu-compare.js` — Comparar VTEX vs Loolu

Convierte el JSON de VTEX al formato exacto de la tabla `StyrkPrincipalCategoriesCatalog` de Loolu, luego lo compara contra el CSV existente de Loolu para encontrar categorías que están en VTEX pero no en Loolu.

```bash
node vtex-to-loolu-compare.js <json-vtex> <csv-loolu> [merchant-id] [--ancestry]
```

| Parámetro | Descripción | Obligatorio |
|---|---|---|
| `json-vtex` | Archivo `.json` con el árbol de categorías de VTEX | Sí |
| `csv-loolu` | Archivo `.csv` con el catálogo actual de Loolu (Styrk) | Sí |
| `merchant-id` | ID del merchant. Si se omite, se infiere del CSV | No |
| `--ancestry` | Genera además el `.sql` de CategoryAncestry | No |

**Ejemplos:**

```bash
# El Salvador (merchant 5, inferido automáticamente)
node vtex-to-loolu-compare.js CategoriasElSalvador_051126.json StyrkPrincipalCategoriesCatalog_202611051224_SQL.csv

# Nicaragua (merchant 2, explícito + ancestry)
node vtex-to-loolu-compare.js merchant2_nicaragua.json StyrkNicaragua.csv 2 --ancestry

# Guatemala (merchant 4)
node vtex-to-loolu-compare.js merchant4_guatemala.json StyrkGuatemala.csv 4
```

**Archivos generados** (en el mismo directorio del JSON):

| Archivo | Descripción |
|---|---|
| `<base>_VTEX_LooluFormat.csv` | JSON de VTEX convertido al esquema de Loolu (23 columnas) |
| `<base>_VTEX_noEnLoolu.csv` | Categorías presentes en VTEX pero NO en Loolu |
| `<base>_CategoryAncestry.sql` | (Solo con `--ancestry`) INSERTs de la tabla CategoryAncestry |

---

### 3. `generate-ancestry-sql.js` — Generar SQL de CategoryAncestry

Script enfocado que genera únicamente el archivo `.sql` con los `INSERT` de la tabla `CategoryAncestry` para las categorías nuevas. Calcula los 5 niveles de ancestros (tatarabuelo, bisabuelo, abuelo, padre, ella misma) usando la jerarquía del JSON.

```bash
node generate-ancestry-sql.js <json-vtex> <csv-loolu> [merchant-id]
```

| Parámetro | Descripción | Obligatorio |
|---|---|---|
| `json-vtex` | Archivo `.json` con el árbol de categorías de VTEX | Sí |
| `csv-loolu` | Archivo `.csv` con el catálogo actual de Loolu (Styrk) | Sí |
| `merchant-id` | ID del merchant. Si se omite, se infiere del CSV | No |

**Ejemplos:**

```bash
# El Salvador (merchant inferido del CSV)
node generate-ancestry-sql.js CategoriasElSalvador_051126.json StyrkPrincipalCategoriesCatalog_202611051224_SQL.csv

# Honduras (merchant 3)
node generate-ancestry-sql.js CAT-M3.json Categories_LOOLU_MERCHANT3.csv 3

# Costa Rica (merchant 6)
node generate-ancestry-sql.js CATS-m6.json CategoriesMerchant6LOOLU_202611061304_SQL.csv 6
```

**Archivo generado:**

| Archivo | Descripción |
|---|---|
| `<base>_CategoryAncestry.sql` | `INSERT INTO CategoryAncestry` con 5 filas por categoría nueva |

**Estructura del SQL generado:**

```sql
INSERT INTO CategoryAncestry (fiMerchantId, fiCategoryId, fiCategoryAncestry, fiOrder)
VALUES
  (5, 824, 0, 1),   -- fiOrder=1: Tatarabuelo  (4 niveles arriba)
  (5, 824, 0, 2),   -- fiOrder=2: Bisabuelo    (3 niveles arriba)
  (5, 824, 8, 3),   -- fiOrder=3: Abuelo       (2 niveles arriba)
  (5, 824, 67, 4),  -- fiOrder=4: Padre        (1 nivel arriba)
  (5, 824, 824, 5), -- fiOrder=5: Ella misma
  ...
```

Cuando un ancestro no existe (la categoría está en un nivel poco profundo), el valor es `0`.

---

## Esquema de la tabla StyrkPrincipalCategoriesCatalog

Los CSV generados respetan el esquema exacto de 23 columnas de la BD de Loolu:

| # | Columna | Descripción |
|---|---|---|
| 1 | `fiMerchantId` | ID del merchant |
| 2 | `fiCategoryId` | ID de la categoría |
| 3 | `fiFatherCategoryId` | ID de la categoría padre (0 = raíz) |
| 4 | `fiChildrenCategoryId` | ID de categoría hija (siempre 0) |
| 5 | `fcName` | Nombre de la categoría |
| 6 | `fcTitle` | Title (SEO) |
| 7 | `fcDescription` | MetaTagDescription |
| 8 | `fcAdWordsRemarketingCode` | Código de AdWords |
| 9 | `fiShowInStoreFront` | Visible en storefront (1/0) |
| 10 | `fiIsActive` | Activa (1/0) |
| 11 | `fiActiveStoreFrontLink` | Link activo (1/0) |
| 12 | `fiShowBrandFilter` | Filtro de marca (1/0) |
| 13 | `fiHasChildren` | Tiene hijos (1/0) |
| 14 | `fiScore` | Score |
| 15 | `fcStockKeepingUnitSelectionMode` | Modo de selección |
| 16 | `fdDateInsert` | Fecha de inserción |
| 17 | `fdDateUpdate` | Fecha de actualización |
| 18 | `fcErpCategoryId` | ID en ERP |
| 19 | `fcErpParentCategoryId` | ID padre en ERP |
| 20 | `fiVtexCategoryId` | ID de la categoría en VTEX |
| 21 | `fbItSent` | Enviado (1/0) |
| 22 | `fiMasterMerchantId` | Merchant maestro |
| 23 | `fiMasterCategoryId` | Categoría maestra |

---

## Flujo de trabajo recomendado

```
1. Exportar el árbol de categorías de VTEX como JSON
2. Exportar el catálogo actual de Loolu como CSV
3. Ejecutar:
   node vtex-to-loolu-compare.js <json> <csv> <merchant> --ancestry
4. Revisar <base>_VTEX_noEnLoolu.csv para confirmar categorías faltantes
5. Ejecutar el INSERT del CSV de diferencias en StyrkPrincipalCategoriesCatalog
6. Ejecutar el <base>_CategoryAncestry.sql para llenar la tabla de ancestros
```

---

## Merchants conocidos

| Merchant ID | País |
|---|---|
| 2 | Nicaragua |
| 3 | Honduras |
| 4 | Guatemala |
| 5 | El Salvador |
| 6 | Costa Rica |

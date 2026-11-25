import { MAX_PRODUCTION_CHUNK_ROWS, MAX_PRODUCTION_CHUNK_BYTES } from './production-csv-validation';

// Leave headroom for the Server Action envelope and JSON escaping under the
// default Next.js request size limit. Server-side limits remain authoritative.
const CLIENT_REQUEST_BYTES = Math.min(MAX_PRODUCTION_CHUNK_BYTES, 512 * 1024);
const MAX_ROW_LENGTH = 8_192;
const MAX_HEADER_LENGTH = 16_384;
const encoder = new TextEncoder();

export class ProductionCsvPreparationError extends Error {}

function serializeRecord(fields: string[]): string {
  // Quote whitespace-sensitive values as well as CSV delimiters. The server
  // uses trim:true, so quoted leading/trailing whitespace must remain quoted.
  return fields.map(value => /[",\r\n]|^\s|\s$/.test(value)
    ? '"' + value.replace(/"/g, '""') + '"'
    : value).join(',');
}

export async function prepareProductionCsv(text: string): Promise<{ headers: string; chunks: string[][]; totalRows: number }> {
  // Use the browser distribution of the existing parser, not a second CSV
  // grammar. Load it only when the operator actually starts an import.
  const { parse } = await import('csv-parse/browser/esm/sync');
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      record_delimiter: ['\r\n', '\n', '\r'],
      max_record_size: MAX_ROW_LENGTH,
    }) as string[][];
  } catch {
    throw new ProductionCsvPreparationError('El CSV tiene comillas, columnas o tamaños de registro inválidos. Corrige el archivo antes de importar.');
  }
  if (records.length < 2) {
    throw new ProductionCsvPreparationError('CSV vacío o sin suficientes datos.');
  }
  const [header, ...data] = records;
  if (header.length > 100) {
    throw new ProductionCsvPreparationError('El CSV no puede contener más de 100 columnas.');
  }
  const headers = serializeRecord(header);
  if (headers.length > MAX_HEADER_LENGTH) {
    throw new ProductionCsvPreparationError('Los encabezados del CSV exceden el tamaño permitido.');
  }
  // Estimate escaped JSON payload size rather than counting only raw CSV
  // characters; non-ASCII text and quotes can increase the request size.
  const baseBytes = encoder.encode(JSON.stringify({ headers, rows: [] })).length;
  const chunks: string[][] = [];
  let current: string[] = [];
  let bytes = baseBytes;

  for (let index = 0; index < data.length; index++) {
    const row = serializeRecord(data[index]);
    if (row.length > MAX_ROW_LENGTH || encoder.encode(row).length > MAX_ROW_LENGTH) {
      throw new ProductionCsvPreparationError(`La fila de datos ${index + 1} supera el tamaño permitido.`);
    }
    const cost = encoder.encode(JSON.stringify(row)).length + 1;
    if (baseBytes + cost > CLIENT_REQUEST_BYTES) {
      throw new ProductionCsvPreparationError(`La fila de datos ${index + 1} supera el tamaño permitido de envío.`);
    }
    if (current.length >= MAX_PRODUCTION_CHUNK_ROWS || bytes + cost > CLIENT_REQUEST_BYTES) {
      chunks.push(current);
      current = [];
      bytes = baseBytes;
    }
    current.push(row);
    bytes += cost;
  }
  if (current.length) chunks.push(current);
  return { headers, chunks, totalRows: data.length };
}

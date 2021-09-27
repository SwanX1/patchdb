import { access, PathLike } from "fs-extra";

export async function checkFileAccess(path: PathLike, mode?: number): Promise<boolean> {
  try {
    await access(path, mode);
  } catch {
    return false;
  }
  return true;
}

export type JSONParsable = string | number | boolean | null | JSONParsable[] | { [key: string]: JSONParsable };
export type JSONObject = { [key: string]: JSONParsable };

export function mapObject<I, O, T extends { [key: string]: I }>(obj: T, transform: (value: I, key: string, obj: T) => O): { [key: string]: O } {
  const result: { [key: string]: O } = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = transform(obj[key], key, obj)
    }
  }
  return result;
}

export function getCheckBitmap(bitmap: number, mode: number): boolean {
  return ((bitmap & mode) ^ mode) === 0;
}
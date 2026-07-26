const MAX_URL_LENGTH = 2048;

export function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const output = value.trim();
  if (!output) throw new Error(`${field} is required`);
  if (output.length > maxLength) throw new Error(`${field} is too long`);
  return output;
}

export function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field, maxLength);
}

export function optionalEmail(value: unknown, field: string): string | undefined {
  const email = optionalString(value, field, 254);
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${field} must be a valid email`);
  return email.toLowerCase();
}

export function optionalUrl(value: unknown, field: string): string | undefined {
  const raw = optionalString(value, field, MAX_URL_LENGTH);
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${field} must use http or https`);
  }
  return url.toString();
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} must be true or false`);
  return value;
}

export function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${field} is invalid`);
  }
  return value as T;
}

export function slug(value: unknown): string {
  const output = requiredString(value, "slug", 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(output)) {
    throw new Error("slug may contain lowercase letters, numbers, and single hyphens");
  }
  return output;
}

export function opaqueRef(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

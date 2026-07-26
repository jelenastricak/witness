export async function requireAdmin(base44: any) {
  const user = await base44.auth.me();
  if (!user) {
    throw new HttpError("Authentication required", 401);
  }
  if (user.role !== "admin") {
    throw new HttpError("Admin access required", 403);
  }
  return user;
}

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function statusFor(error: unknown): number {
  return error instanceof HttpError ? error.status : 500;
}

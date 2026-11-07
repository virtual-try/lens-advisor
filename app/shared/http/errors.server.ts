export interface FieldError {
  path: string;
  code: string;
}

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    fields?: FieldError[];
  };
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly fields?: FieldError[];

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: FieldError[]
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", code = "BAD_REQUEST", fields?: FieldError[]) {
    super(400, code, message, fields);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code = "UNAUTHORIZED") {
    super(401, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", code = "NOT_FOUND") {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT") {
    super(409, code, message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests", code = "RATE_LIMITED") {
    super(429, code, message);
  }
}

export class InternalServerError extends AppError {
  constructor(message = "Internal server error", code = "INTERNAL_SERVER_ERROR") {
    super(500, code, message);
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const body: ErrorResponseBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields && error.fields.length > 0 ? { fields: error.fields } : {}),
      },
    };
    return new Response(JSON.stringify(body), {
      status: error.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  const defaultBody: ErrorResponseBody = {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  };
  return new Response(JSON.stringify(defaultBody), {
    status: 500,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export const jsonError = errorResponse;
export const respondWithError = errorResponse;

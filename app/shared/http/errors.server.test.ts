import { describe, expect, it } from "vitest";
import {
  AppError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  errorResponse,
  jsonError,
} from "./errors.server";

describe("errors.server", () => {
  it("formats AppError into the ARCHITECTURE.md JSON error shape", async () => {
    const error = new AppError(404, "NOT_FOUND", "Item was not found");
    const response = errorResponse(error);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Item was not found",
      },
    });
  });

  it("includes fields array for validation error when provided", async () => {
    const error = new BadRequestError("Invalid input", "VALIDATION_FAILED", [
      { path: "sph", code: "OUT_OF_RANGE" },
    ]);
    const response = jsonError(error);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        fields: [{ path: "sph", code: "OUT_OF_RANGE" }],
      },
    });
  });

  it("handles UnauthorizedError with 401 status", async () => {
    const error = new UnauthorizedError("App proxy signature invalid", "INVALID_SIGNATURE");
    const response = errorResponse(error);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("INVALID_SIGNATURE");
  });

  it("handles NotFoundError with 404 status", async () => {
    const error = new NotFoundError("Lens group not found", "LENS_GROUP_NOT_FOUND");
    const response = errorResponse(error);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error.code).toBe("LENS_GROUP_NOT_FOUND");
    expect(data.error.message).toBe("Lens group not found");
  });

  it("maps unknown non-AppError to safe 500 response without leaking internal details", async () => {
    const rawError = new Error("Database password failed on 10.0.0.1");
    const response = errorResponse(rawError);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
      },
    });
    expect(JSON.stringify(data)).not.toContain("Database password");
  });
});

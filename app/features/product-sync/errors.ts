import { AppError, type FieldError } from "../../shared/http/errors.server";

export class SyncError extends AppError {
  constructor(message: string, code = "SYNC_FAILED", fields?: FieldError[]) {
    super(400, code, message, fields);
    this.name = "SyncError";
  }
}

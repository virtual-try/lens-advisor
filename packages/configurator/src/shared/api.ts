import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { z } from "zod";
import {
  catalogResponseSchema,
  prescriptionSubmitBodySchema,
  uploadUrlRequestSchema,
  type CatalogResponse,
  type PrescriptionSubmitBody,
  type UploadUrlRequest,
} from "../../../rx-core/src/index.js";

export const prescriptionResponseSchema = z.object({
  rxRef: z.string().min(1),
});
export type PrescriptionResponse = z.infer<typeof prescriptionResponseSchema>;

export const uploadUrlResponseSchema = z.object({
  draftId: z.string().min(1),
  uploadUrl: z.string().min(1),
  key: z.string().min(1),
});
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;

export interface ApiErrorDetails {
  code: string;
  message?: string;
  status?: number;
  fields?: Array<{ path: string; code: string }>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly fields?: Array<{ path: string; code: string }>;

  constructor(details: ApiErrorDetails) {
    super(details.message ?? details.code);
    this.name = "ApiError";
    this.code = details.code;
    this.status = details.status;
    this.fields = details.fields;
  }
}

export interface ApiClientOptions {
  proxyBase?: string;
  fetchFn?: typeof fetch;
}

export interface ApiClient {
  readonly proxyBase: string;
  getCatalog: (productId?: string) => Promise<CatalogResponse>;
  submitPrescription: (body: PrescriptionSubmitBody) => Promise<PrescriptionResponse>;
  getUploadUrl: (file: UploadUrlRequest | { contentType: string; size: number; draftId?: string }) => Promise<UploadUrlResponse>;
  uploadFile: (url: string, file: Blob | File | ArrayBuffer | ArrayBufferView) => Promise<void>;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const proxyBase = options.proxyBase?.replace(/\/+$/, "") || "/apps/lens-advisor";
  const rawFetch = options.fetchFn || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);

  if (!rawFetch) {
    throw new Error("fetch is not available. Please pass a fetchFn to createApiClient.");
  }
  const fetchFn = rawFetch;

  async function requestJson(
    url: string,
    init?: RequestInit,
  ): Promise<{ status: number; json: unknown }> {
    let response: Response;
    try {
      response = await fetchFn(url, init);
    } catch (err) {
      throw new ApiError({
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Network error",
      });
    }

    let text = "";
    try {
      text = await response.text();
    } catch (err) {
      throw new ApiError({
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Failed to read response body",
        status: response.status,
      });
    }

    let json: unknown = null;
    if (text && text.trim().length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiError({
          code: "BAD_RESPONSE",
          message: "Server returned non-JSON response",
          status: response.status,
        });
      }
    }

    if (!response.ok) {
      const errObj = (json as { error?: { code?: string; message?: string; fields?: Array<{ path: string; code: string }> } })?.error;
      const code = errObj?.code || (response.status === 404 ? "NOT_AVAILABLE" : response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR");
      throw new ApiError({
        code,
        message: errObj?.message,
        status: response.status,
        fields: errObj?.fields,
      });
    }

    return { status: response.status, json };
  }

  return {
    proxyBase,

    async getCatalog(productId?: string): Promise<CatalogResponse> {
      const query = productId ? `?product_id=${encodeURIComponent(productId)}` : "";
      const url = `${proxyBase}/catalog${query}`;
      const { status, json } = await requestJson(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const parsed = catalogResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError({
          code: "BAD_RESPONSE",
          message: parsed.error.message,
          status,
        });
      }
      return parsed.data;
    },

    async submitPrescription(body: PrescriptionSubmitBody): Promise<PrescriptionResponse> {
      const reqParse = prescriptionSubmitBodySchema.safeParse(body);
      if (!reqParse.success) {
        throw new ApiError({
          code: "VALIDATION_FAILED",
          message: reqParse.error.message,
          status: 400,
        });
      }

      const url = `${proxyBase}/prescriptions`;
      const { status, json } = await requestJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(reqParse.data),
      });

      const parsed = prescriptionResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError({
          code: "BAD_RESPONSE",
          message: parsed.error.message,
          status,
        });
      }
      return parsed.data;
    },

    async getUploadUrl(
      file: UploadUrlRequest | { contentType: string; size: number; draftId?: string },
    ): Promise<UploadUrlResponse> {
      const reqParse = uploadUrlRequestSchema.safeParse(file);
      if (!reqParse.success) {
        throw new ApiError({
          code: "VALIDATION_FAILED",
          message: reqParse.error.message,
          status: 400,
        });
      }

      const url = `${proxyBase}/upload-url`;
      const { status, json } = await requestJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(reqParse.data),
      });

      const parsed = uploadUrlResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError({
          code: "BAD_RESPONSE",
          message: parsed.error.message,
          status,
        });
      }
      return parsed.data;
    },

    async uploadFile(url: string, file: Blob | File | ArrayBuffer | ArrayBufferView): Promise<void> {
      let response: Response;
      const headers: Record<string, string> = {};
      if (typeof Blob !== "undefined" && file instanceof Blob && file.type) {
        headers["Content-Type"] = file.type;
      }

      try {
        response = await fetchFn(url, {
          method: "PUT",
          headers,
          body: file as BodyInit,
        });
      } catch (err) {
        throw new ApiError({
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Upload network error",
        });
      }

      if (!response.ok) {
        throw new ApiError({
          code: "UPLOAD_FAILED",
          message: `File upload failed with status ${response.status}`,
          status: response.status,
        });
      }
    },
  };
}

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error("useApi must be used within an ApiContext.Provider");
  }
  return api;
}

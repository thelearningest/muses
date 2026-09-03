export type D1Result<T = Record<string, unknown>> = {
  success: boolean;
  results?: T[];
  meta?: { changes?: number } & Record<string, unknown>;
  error?: string;
};

export interface D1PreparedStatementBinding {
  bind(...values: unknown[]): D1PreparedStatementBinding;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatementBinding;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatementBinding[],
  ): Promise<D1Result<T>[]>;
}

export type R2PutOptions = {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
  onlyIf?: Record<string, unknown>;
};

export type R2ObjectMetadata = {
  key: string;
  size: number;
  etag?: string;
  uploaded?: Date;
  customMetadata?: Record<string, string>;
};

export type R2GetResult = {
  key: string;
  customMetadata?: Record<string, string>;
  body?: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};

export type R2ListResult = {
  objects: R2ObjectMetadata[];
  truncated: boolean;
  cursor?: string;
};

export interface R2BucketBinding {
  put(
    key: string,
    value: unknown,
    options?: R2PutOptions,
  ): Promise<{ key: string } | null>;
  get(key: string): Promise<R2GetResult | null>;
  head(key: string): Promise<R2ObjectMetadata | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    include?: string[];
  }): Promise<R2ListResult>;
}

export type BookPipelineRuntimeEnv = {
  DB: D1DatabaseBinding;
  BOOK_JOBS: R2BucketBinding;
  OPENAI_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  BOOK_CAPABILITY_HMAC_KEY?: string;
  BOOK_IDENTITY_HMAC_KEY?: string;
  BOOK_PROVIDER_URL_HMAC_KEY?: string;
} & Record<string, unknown>;

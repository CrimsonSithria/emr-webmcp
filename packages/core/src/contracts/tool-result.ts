export type ToolErrorCode =
  | 'unauthorized'
  | 'unsupported'
  | 'not-found'
  | 'invalid-input'
  | 'conflict'
  | 'upstream';

export type ToolResult<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: 'unauthorized' | 'unsupported' | 'not-found' | 'invalid-input' | 'conflict' | 'upstream';
    message: string;
    retryable: boolean;
  };
  meta: {
    invocationId: string;
    adapterId: string;
    generatedAt: string;
    truncated: boolean;
    nextCursor?: string;
  };
};

export type ToolResultDeps = {
  randomUUID: () => string;
  now: () => Date;
  adapterId: string;
};

export type SuccessResultOptions = {
  truncated?: boolean;
  nextCursor?: string;
};

export type PublicToolError = {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
};

function buildMeta(
  deps: ToolResultDeps,
  options?: SuccessResultOptions,
): ToolResult<never>['meta'] {
  const meta: ToolResult<never>['meta'] = {
    invocationId: deps.randomUUID(),
    adapterId: deps.adapterId,
    generatedAt: deps.now().toISOString(),
    truncated: options?.truncated ?? false,
  };

  if (options?.nextCursor !== undefined) {
    return {
      ...meta,
      nextCursor: options.nextCursor,
    };
  }

  return meta;
}

export function successResult<T>(
  deps: ToolResultDeps,
  data: T,
  options?: SuccessResultOptions,
): ToolResult<T> {
  return {
    ok: true,
    data,
    meta: buildMeta(deps, options),
  };
}

export function errorResult(deps: ToolResultDeps, error: PublicToolError): ToolResult<never> {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
    meta: buildMeta(deps),
  };
}

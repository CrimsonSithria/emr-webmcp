import type { ToolErrorCode } from './tool-result.js';

export class AdapterError extends Error {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly retryable: boolean;

  constructor(code: ToolErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.message = message;
    this.retryable = retryable;
  }
}

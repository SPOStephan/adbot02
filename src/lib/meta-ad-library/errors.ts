export class MetaAdLibraryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "MetaAdLibraryError";
    this.code = code;
    this.status = status;
  }
}

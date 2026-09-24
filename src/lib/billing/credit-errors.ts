export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS" as const;

  constructor() {
    super("INSUFFICIENT_CREDITS");
    this.name = "InsufficientCreditsError";
  }
}

export class CreditServiceUnavailableError extends Error {
  readonly code = "CREDIT_SERVICE_UNAVAILABLE" as const;

  constructor(message = "Der Credit-Service ist vorübergehend nicht erreichbar.") {
    super(message);
    this.name = "CreditServiceUnavailableError";
  }
}

export class CreditServiceContractError extends Error {
  readonly code = "CREDIT_SERVICE_CONTRACT_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "CreditServiceContractError";
  }
}

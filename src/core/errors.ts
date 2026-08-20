export class ConfigError extends Error {
  constructor(message: string, readonly path?: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class VaultDenied extends Error {
  constructor(readonly reason: string, readonly path: string) {
    super(`vault write denied (${reason}): ${path}`);
    this.name = "VaultDenied";
  }
}

export class Refused extends Error {
  constructor(readonly reason: string, readonly detail: Record<string, unknown> = {}) {
    super(`refused: ${reason}`);
    this.name = "Refused";
  }
}

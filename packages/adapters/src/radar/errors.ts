/** A refusal the owner can read; the API maps `code` onto its error of the same name. */
export class RadarError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "RadarError";
  }
}

// B07: errors from the Prompt Library carry the frozen `{error:{code,message,details?}}` shape.
export class PromptError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'PromptError';
  }
}

import Anthropic from '@anthropic-ai/sdk';

export interface AiRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface AiResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type AiErrorKind = 'refusal' | 'auth' | 'rate_limit' | 'bad_request' | 'network' | 'empty' | 'unknown';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** The slice of the Anthropic API the app needs, so tests can swap in a fake. */
export interface AiClient {
  generate(req: AiRequest): Promise<AiResult>;
}

/** `output_config.effort` is accepted by the current model families only; older models reject it. */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|fable|mythos|haiku-5)/.test(model);
}

export function createAnthropicClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey, timeout: 180_000 });

  return {
    async generate(req: AiRequest): Promise<AiResult> {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          ...(supportsEffort(req.model) ? { output_config: { effort: 'medium' as const } } : {}),
        });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new AiError('auth', 'Clé API refusée par Anthropic');
        }
        if (err instanceof Anthropic.RateLimitError) {
          throw new AiError('rate_limit', 'Limite de requêtes Anthropic atteinte, réessayez dans un moment');
        }
        if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.BadRequestError) {
          throw new AiError('bad_request', `Requête refusée par Anthropic : ${err.message}`);
        }
        if (err instanceof Anthropic.APIConnectionError) {
          throw new AiError('network', 'Impossible de joindre l\'API Anthropic');
        }
        if (err instanceof Anthropic.APIError) {
          throw new AiError('unknown', `Erreur Anthropic (${err.status ?? '?'})`);
        }
        throw err;
      }

      if (response.stop_reason === 'refusal') {
        throw new AiError('refusal', 'Le modèle a refusé de générer ce récap');
      }
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      if (!text) {
        throw new AiError(
          'empty',
          response.stop_reason === 'max_tokens' ? 'Réponse tronquée avant la fin' : 'Le modèle n\'a renvoyé aucun texte',
        );
      }
      return {
        text,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}

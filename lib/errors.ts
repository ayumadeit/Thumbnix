export type ErrorCode =
  | 'INVALID_URL'
  | 'VIDEO_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_TIMEOUT'
  | 'INTERNAL';

export interface PlayfulErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
  };
}

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_URL: "Hmm, that doesn't look like a YouTube link. Check it and try again.",
  VIDEO_NOT_FOUND: "Oops! Our little buddy couldn't find that video.",
  RATE_LIMITED: "Whoa, slow down! Our buddy needs a quick breather.",
  UPSTREAM_TIMEOUT: "YouTube is being slow today. Try again in a moment.",
  INTERNAL: "Something went sideways on our end. Not your fault."
};

const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  VIDEO_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL: 500
};

export function createErrorResponse(code: ErrorCode, customMessage?: string): {
  status: number;
  body: PlayfulErrorResponse;
} {
  return {
    status: ERROR_STATUS_CODES[code],
    body: {
      error: {
        code,
        message: customMessage || ERROR_MESSAGES[code]
      }
    }
  };
}

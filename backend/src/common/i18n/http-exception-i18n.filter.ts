import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { translateMessageFr } from './messages-fr';

// Returns HttpException bodies exactly as Nest would, except that when the request asks for French
// (Accept-Language: fr...) the human-readable `message` and `error` fields are translated.
@Catch(HttpException)
export class HttpExceptionI18nFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const status = exception.getStatus();
    const body = exception.getResponse();
    const wantsFrench = /^fr\b/i.test(String(req?.headers?.['accept-language'] ?? ''));

    let out: unknown = body;
    if (wantsFrench) {
      if (typeof body === 'string') out = translateMessageFr(body);
      else if (body && typeof body === 'object') {
        const b = { ...(body as Record<string, unknown>) };
        if (typeof b.message === 'string') b.message = translateMessageFr(b.message);
        else if (Array.isArray(b.message)) b.message = b.message.map((m) => (typeof m === 'string' ? translateMessageFr(m) : m));
        if (typeof b.error === 'string') b.error = translateMessageFr(b.error);
        out = b;
      }
    }
    res.status(status).json(typeof out === 'string' ? { statusCode: status, message: out } : out);
  }
}

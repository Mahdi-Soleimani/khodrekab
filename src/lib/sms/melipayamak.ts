import { SmsProvider, SendOtpInput, SendOtpResult, MeliPayamakConfig, MeliPayamakResponse } from './types';
import { maskPhone } from './phone';

export interface ExtendedMeliPayamakConfig extends MeliPayamakConfig {
  endpoint?: string;
  timeoutMs?: number;
}

export class MeliPayamakProvider implements SmsProvider {
  public readonly name = 'MeliPayamak';
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ExtendedMeliPayamakConfig) {
    this.endpoint = config.endpoint || 'https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber';
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  public async sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
    const masked = maskPhone(input.phone);

    try {
      // Official MeliPayamak REST contract requires application/x-www-form-urlencoded parameters
      const params = new URLSearchParams({
        username: this.config.username,
        password: this.config.password,
        text: input.code,
        to: input.phone,
        bodyId: this.config.bodyId.toString(),
      });

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const status = response.status;
        console.error(`[MeliPayamak] Gateway HTTP error: ${status} for ${masked}`);
        return {
          success: false,
          error: `HTTP_${status}`,
          userMessage: 'ارسال کد با مشکل مواجه شد. لطفاً چند لحظه بعد دوباره امتحان کنید.',
        };
      }

      const data: MeliPayamakResponse = await response.json();

      // Check success: RetStatus === 1 or Value is a numeric tracking ID (> 5 chars, non-negative)
      const isSuccess =
        data.RetStatus === 1 ||
        (typeof data.Value === 'string' && data.Value.length > 5 && !data.Value.startsWith('-'));

      if (isSuccess) {
        const messageId = String(data.Value ?? '');
        console.log(`[MeliPayamak] OTP sent successfully to ${masked} (RecId: ${messageId})`);
        return {
          success: true,
          providerMessageId: messageId,
        };
      }

      // Handle provider error codes without leaking internal details or OTP
      const errorCode = String(data.Value ?? data.RetStatus ?? 'UNKNOWN');
      console.error(`[MeliPayamak] Gateway rejected request for ${masked}. Code: ${errorCode}`);

      return {
        success: false,
        error: `PROVIDER_ERROR_${errorCode}`,
        userMessage: 'ارسال کد با مشکل مواجه شد. لطفاً چند لحظه بعد دوباره امتحان کنید.',
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          console.error(`[MeliPayamak] Gateway timeout (${this.timeoutMs}ms) for ${masked}`);
          return {
            success: false,
            error: 'TIMEOUT_EXCEPTION',
            userMessage: 'پاسخی از سرور پیامک دریافت نشد. لطفاً بعداً تلاش کنید.',
          };
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[MeliPayamak] Network exception for ${masked}:`, msg);
      return {
        success: false,
        error: 'NETWORK_EXCEPTION',
        userMessage: 'خطا در ارتباط با سرور پیامک. لطفاً بعداً تلاش کنید.',
      };
    }
  }
}

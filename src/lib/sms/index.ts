import { SmsProvider, SendOtpInput, SendOtpResult } from './types';
import { MeliPayamakProvider } from './melipayamak';
import { maskPhone } from './phone';

class DevMockSmsProvider implements SmsProvider {
  public readonly name = 'DevMockSmsProvider';

  public async sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
    const masked = maskPhone(input.phone);
    console.log(`[DEV SMS MOCK] OTP requested for ${masked}. Gateway credentials not configured (Development mode only).`);
    return {
      success: true,
      providerMessageId: `MOCK_${Date.now()}`,
    };
  }
}

function resolveSmsProvider(): SmsProvider {
  const username = process.env.MELIPAYAMAK_USERNAME?.trim();
  const password = process.env.MELIPAYAMAK_PASSWORD?.trim();
  const bodyIdStr = process.env.MELIPAYAMAK_BODY_ID?.trim();

  const isProduction = process.env.NODE_ENV === 'production';

  if (username && password && bodyIdStr) {
    const bodyId = parseInt(bodyIdStr, 10);
    if (!isNaN(bodyId) && bodyId > 0) {
      return new MeliPayamakProvider({ username, password, bodyId });
    }
  }

  // Strictly forbid fake success in production
  if (isProduction) {
    return {
      name: 'UnconfiguredProvider',
      sendOtp: async (input: SendOtpInput) => {
        console.error(`[SMS_ERROR] MeliPayamak credentials or MELIPAYAMAK_BODY_ID missing in production for ${maskPhone(input.phone)}`);
        return {
          success: false,
          error: 'GATEWAY_CREDENTIALS_MISSING',
          userMessage: 'سرویس ارسال پیامک موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.',
        };
      },
    };
  }

  // Development/Test fallback
  return new DevMockSmsProvider();
}

export const smsService = {
  sendOtp: async (input: SendOtpInput): Promise<SendOtpResult> => {
    const provider = resolveSmsProvider();
    return provider.sendOtp(input);
  },
};

export * from './types';
export * from './phone';

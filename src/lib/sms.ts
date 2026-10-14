import { smsService } from './sms/index';
import { normalizeIranianPhone } from './sms/phone';

export async function sendSMS(phone: string, text: string) {
  // Legacy fallback placeholder if called directly
  console.warn('[SMS] Direct sendSMS is deprecated. Use sendOTP via BaseServiceNumber.');
  const normalized = normalizeIranianPhone(phone) || phone;
  return smsService.sendOtp({ phone: normalized, code: text });
}

export async function sendOTP(phone: string, otp: string) {
  const normalized = normalizeIranianPhone(phone);
  if (!normalized) {
    throw new Error('Invalid Iranian mobile number format');
  }
  return smsService.sendOtp({ phone: normalized, code: otp });
}

export { smsService };
export * from './sms/types';
export * from './sms/phone';


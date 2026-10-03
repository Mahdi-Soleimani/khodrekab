export interface SendOtpInput {
  phone: string; // Canonical normalized Iranian phone (09xxxxxxxxx)
  code: string;  // Generated numeric OTP code
}

export interface SendOtpResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  userMessage?: string;
}

export interface SmsProvider {
  name: string;
  sendOtp(input: SendOtpInput): Promise<SendOtpResult>;
}

export interface MeliPayamakConfig {
  username: string;
  password: string;
  bodyId: number;
}

export interface MeliPayamakResponse {
  Value?: string | number;
  RetStatus?: number;
  StrRetStatus?: string;
}

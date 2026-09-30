export async function sendSMS(phone: string, text: string) {
  // MeliPayamak implementation
  const username = process.env.MELIPAYAMAK_USERNAME;
  const password = process.env.MELIPAYAMAK_PASSWORD;

  if (!username || !password) {
    console.warn('MeliPayamak credentials missing. Logging SMS instead:', phone, text);
    return;
  }

  try {
    const response = await fetch('https://rest.payamak-panel.com/api/SendSMS/SendSMS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        password,
        to: phone,
        from: process.env.MELIPAYAMAK_FROM || '5000...', // default sender
        text,
        isFlash: false
      })
    });
    const result = await response.json();
    console.log('SMS sent result:', result);
    return result;
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

export async function sendOTP(phone: string, otp: string) {
  const text = `کد تایید شما در کارنو: ${otp}\nلغو عضویت: ارسال 11`;
  return sendSMS(phone, text);
}

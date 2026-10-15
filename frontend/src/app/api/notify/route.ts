import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const { phone, message, force, callmebotApiKey } = await request.json();
    if (!phone || !message) {
      return NextResponse.json({ error: 'Phone and message are required' }, { status: 400 });
    }

    // Clean phone number: remove non-numeric characters
    let cleanPhone = phone.replace(/[^0-9+]/g, '');
    if (/^[6-9]\d{9}$/.test(cleanPhone)) {
      cleanPhone = '+91' + cleanPhone;
    } else if (/^91[6-9]\d{9}$/.test(cleanPhone)) {
      cleanPhone = '+' + cleanPhone;
    }
    const cleanNumberOnly = cleanPhone.replace(/\+/g, '');
    const indian10Digit = cleanNumberOnly.startsWith('91') ? cleanNumberOnly.slice(2) : cleanNumberOnly;

    let deliveryLog: {
      provider: string;
      success: boolean;
      details?: any;
    }[] = [];

    // ──────────────────────────────────────────────────────────────────────────
    // Provider 1: CallMeBot WhatsApp Automated Gateway (100% Free Automated WhatsApp)
    // Sends background automated WhatsApp messages without any user clicking!
    // ──────────────────────────────────────────────────────────────────────────
    const effectiveCallmeApiKey = callmebotApiKey || process.env.CALLMEBOT_API_KEY;
    if (effectiveCallmeApiKey) {
      try {
        const cmbUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanNumberOnly}&text=${encodeURIComponent(message)}&apikey=${effectiveCallmeApiKey}`;
        const cmbRes = await fetch(cmbUrl);
        const cmbText = await cmbRes.text();
        const ok = cmbText.toLowerCase().includes('success') || cmbRes.status === 200;
        deliveryLog.push({
          provider: 'CallMeBot WhatsApp (Automated Direct)',
          success: ok,
          details: cmbText.slice(0, 100),
        });
      } catch (err: any) {
        deliveryLog.push({ provider: 'CallMeBot WhatsApp', success: false, details: err.message });
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Provider 2: Fast2SMS (Indian Bulk SMS Gateway)
    // ──────────────────────────────────────────────────────────────────────────
    if (process.env.FAST2SMS_API_KEY) {
      try {
        const f2sRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            authorization: process.env.FAST2SMS_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            route: 'q',
            message: message,
            language: 'english',
            numbers: indian10Digit,
          }),
        });
        const f2sData = await f2sRes.json();
        deliveryLog.push({ provider: 'Fast2SMS Indian Gateway', success: !!f2sData.return, details: f2sData.message });
      } catch (err: any) {
        deliveryLog.push({ provider: 'Fast2SMS', success: false, details: err.message });
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Provider 3: Twilio SMS / WhatsApp (if configured)
    // ──────────────────────────────────────────────────────────────────────────
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const isWhatsapp = process.env.TWILIO_PHONE_NUMBER.startsWith('whatsapp:');
        const toField = isWhatsapp ? `whatsapp:${cleanPhone}` : cleanPhone;

        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${auth}`,
            },
            body: new URLSearchParams({
              From: process.env.TWILIO_PHONE_NUMBER,
              To: toField,
              Body: message,
            }),
          }
        );
        const twilioData = await twilioRes.json();
        deliveryLog.push({ provider: 'Twilio Gateway', success: !!twilioData.sid, details: twilioData.error_message || twilioData.sid });
      } catch (err: any) {
        deliveryLog.push({ provider: 'Twilio', success: false, details: err.message });
      }
    }

    // Fallback: WhatsApp direct link
    const waUrl = `https://wa.me/${cleanNumberOnly}?text=${encodeURIComponent(message)}`;

    const anyApiSuccess = deliveryLog.some(d => d.success);

    return NextResponse.json({
      success: anyApiSuccess,
      phone: cleanPhone,
      deliveryLog,
      whatsappUrl: waUrl,
      automatedDelivered: anyApiSuccess,
    });
  } catch (error) {
    console.error('Notify error:', error);
    return NextResponse.json({ error: 'Failed to process notification' }, { status: 500 });
  }
}

// Background Cron/Status Check
export async function GET() {
  try {
    const items = await prisma.foodItem.findMany({
      where: { is_consumed: false },
      orderBy: { expiry_date: 'asc' },
    });

    const expiring = items.filter(item => {
      const diffTime = new Date(item.expiry_date + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0);
      const days = Math.ceil(diffTime / 86400000);
      return days <= 1;
    });

    return NextResponse.json({
      activeItems: items.length,
      expiringTodayOrTomorrow: expiring.length,
      items: expiring,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to query expiry status' }, { status: 500 });
  }
}

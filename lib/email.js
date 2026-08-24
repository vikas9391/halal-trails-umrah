import { Resend } from 'resend';

function money(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n); }
function esc(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function client() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendTravelerConfirmation(booking, { pendingManual = false } = {}) {
  const resend = client();
  if (!resend) {
    console.warn('RESEND_API_KEY not configured; skipping traveler email for', booking.id);
    return;
  }
  const q = booking.quote;
  const first = esc(booking.fields.first_name);
  const schedule = q.schedule.map(x => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e6e8e3">${esc(x.date)}</td><td style="padding:8px 12px;border-bottom:1px solid #e6e8e3;text-align:right"><strong>${money(x.amount)}</strong></td></tr>`).join('');
  const title = pendingManual ? 'Registration received — payment verification pending' : 'Your Umrah reservation payment is confirmed';
  const sender = pendingManual
    ? (process.env.REGISTRATION_EMAIL_FROM || 'Halal Trails Registration <registration@halal-trails.com>')
    : (process.env.BILLING_EMAIL_FROM || 'Halal Trails Billing <billing@halal-trails.com>');
  const statusCopy = pendingManual
    ? 'We received your registration and payment evidence. Your seat is pending manual payment verification by the Halal Trails team.'
    : `We received your ${money(q.dueToday)} payment and linked it to your Thanksgiving Break Umrah reservation.`;

  const html = `
  <div style="font-family:Arial,sans-serif;background:#f5f7f2;padding:32px;color:#172014">
    <div style="max-width:640px;margin:auto;background:white;border-radius:18px;overflow:hidden;border:1px solid #dfe5dc">
      <div style="background:#23430f;color:white;padding:28px 32px"><div style="font-size:12px;letter-spacing:.18em">HALAL TRAILS</div><h1 style="font-family:Georgia,serif;font-weight:500;margin:10px 0 0">${title}</h1></div>
      <div style="padding:32px"><p>As-salamu alaykum ${first},</p><p>${statusCopy}</p>
        <div style="background:#f3f6ef;padding:18px;border-radius:12px;margin:22px 0"><strong>Booking reference:</strong> ${esc(booking.id)}<br><strong>Travel dates:</strong> November 23 – December 2, 2026<br><strong>Room:</strong> ${esc(q.roomLabel)}<br><strong>Payment plan:</strong> ${esc(q.planLabel)}<br><strong>Preferred gateway:</strong> ${esc(booking.fields.gateway)}</div>
        <h3>Package total: ${money(q.total)}</h3><table style="width:100%;border-collapse:collapse">${schedule}</table>
        <p style="margin-top:24px">Next steps: keep an eye on your email for pre-trip preparation, final flight details, hotel confirmation and visa/document updates. Please do not email passport scans unless the Halal Trails team specifically requests a secure upload.</p>
        <p>Questions? Reply to this email or contact <a href="mailto:info@halal-trails.com">info@halal-trails.com</a> · <a href="tel:+12142336721">(214) 233-6721</a>.</p>
        <p>JazakAllahu khairan,<br><strong>Halal Trails</strong></p>
      </div>
    </div>
  </div>`;

  await resend.emails.send({
    from: sender,
    to: [booking.fields.email],
    replyTo: process.env.INFO_EMAIL || 'info@halal-trails.com',
    subject: pendingManual ? `Registration received · ${booking.id}` : `Payment confirmed · Thanksgiving Umrah 2026 · ${booking.id}`,
    html,
  });
}

export async function sendTeamNotification(booking, subjectPrefix = 'New Umrah booking') {
  const resend = client();
  if (!resend) return;
  const q = booking.quote;
  const html = `<div style="font-family:Arial,sans-serif"><h2>${esc(subjectPrefix)}</h2><p><strong>Booking:</strong> ${esc(booking.id)}</p><p><strong>Traveler:</strong> ${esc(booking.fields.first_name)} ${esc(booking.fields.last_name)}<br><strong>Email:</strong> ${esc(booking.fields.email)}<br><strong>Phone:</strong> ${esc(booking.fields.phone)}<br><strong>Gateway:</strong> ${esc(booking.fields.gateway)}<br><strong>Room:</strong> ${esc(q.roomLabel)}<br><strong>Plan:</strong> ${esc(q.planLabel)}<br><strong>Total:</strong> ${money(q.total)}<br><strong>Status:</strong> ${esc(booking.status)}</p><p>Sensitive passport and health documents are stored encrypted and are not attached to email.</p></div>`;
  await resend.emails.send({
    from: process.env.REGISTRATION_EMAIL_FROM || 'Halal Trails Registration <registration@halal-trails.com>',
    to: [process.env.TEAM_EMAIL || 'registration@halal-trails.com'],
    replyTo: process.env.INFO_EMAIL || 'info@halal-trails.com',
    subject: `${subjectPrefix} · ${booking.id}`,
    html,
  });
}

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { fileURLToPath } from 'node:url';
import { quote, PASSPORT_MIN_EXPIRY, TRIP_START } from './lib/pricing.js';
import { ensureDataDirs, saveBooking, updateBooking, getBooking, saveUpload } from './lib/store.js';
import { sendTravelerConfirmation, sendTeamNotification } from './lib/email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

// Stripe requires the unparsed request body to verify webhook signatures.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe webhook is not configured');
  try {
    const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status === 'paid' && session.metadata?.booking_id) {
        const booking = await updateBooking(session.metadata.booking_id, b => {
          b.status = b.quote.plan === 'deposit3' ? 'deposit_paid' : 'paid';
          b.stripe = { sessionId: session.id, paymentIntentId: session.payment_intent, amountTotal: session.amount_total, paymentStatus: session.payment_status };
          b.updatedAt = new Date().toISOString();
          return b;
        });
        await Promise.allSettled([
          sendTravelerConfirmation(booking),
          sendTeamNotification(booking, 'Paid Umrah reservation'),
        ]);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 4, fields: 80 },
  fileFilter(req, file, cb) {
    const ok = ['image/jpeg','image/png','application/pdf'].includes(file.mimetype);
    cb(ok ? null : new Error(`Unsupported file type for ${file.fieldname}`), ok);
  },
});
const uploadFields = upload.fields([
  { name: 'passport_scan', maxCount: 1 },
  { name: 'traveler_photo', maxCount: 1 },
  { name: 'meningitis_card', maxCount: 1 },
  { name: 'payment_screenshot', maxCount: 1 },
]);

function ageOn(dateOfBirth, atDate) {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return -1;
  let age = atDate.getUTCFullYear() - dob.getUTCFullYear();
  const m = atDate.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && atDate.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

function validate(fields, files) {
  const required = ['first_name','last_name','dob','phone','email','address','city','state','zip','gender','gateway','room','meningitis_vacc','mobility','passport_number','passport_country','passport_issue_date','passport_expiry','nationality','ec_name','ec_relationship','ec_phone','physically_independent','visa_help','plan','payment_method','agree_terms'];
  const missing = required.filter(k => !String(fields[k] || '').trim());
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) throw new Error('Please enter a valid email address');
  if (ageOn(fields.dob, TRIP_START) < 18) throw new Error('Travelers must be 18 or older at the time of travel');
  if (fields.passport_expiry < PASSPORT_MIN_EXPIRY) throw new Error(`Passport must be valid through at least ${PASSPORT_MIN_EXPIRY}`);
  if (!files.passport_scan?.[0]) throw new Error('Passport bio-page upload is required');
  if (!files.traveler_photo?.[0]) throw new Error('Passport-style traveler photo is required');
  if (['yes','exempt'].includes(fields.meningitis_vacc) && !files.meningitis_card?.[0]) throw new Error('Vaccination card or exemption letter is required for the selected meningitis response');
  if (/Zelle|Cash/i.test(fields.payment_method) && !files.payment_screenshot?.[0]) throw new Error('Payment screenshot is required for Zelle/CashApp');
  if (!['Credit / Debit card (Stripe)', 'Zelle — billing@halal-trails.com · screenshot required', 'CashApp — screenshot required'].includes(fields.payment_method)) throw new Error('Unsupported payment method');
}

app.post('/api/bookings', uploadFields, async (req, res) => {
  try {
    validate(req.body, req.files || {});
    const q = quote({ room: req.body.room, plan: req.body.plan, now: new Date() });
    const id = `HT26-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const fields = { ...req.body };
    delete fields.promo_code;

    const storedFiles = [];
    for (const [fieldname, arr] of Object.entries(req.files || {})) {
      for (const f of arr) storedFiles.push(await saveUpload({ bookingId: id, ...f }));
    }

    let booking = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending_payment',
      fields,
      quote: q,
      files: storedFiles,
    };
    await saveBooking(booking);

    if (req.body.payment_method === 'Credit / Debit card (Stripe)') {
      if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet. Please contact Halal Trails.' });
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: fields.email,
        client_reference_id: id,
        success_url: `${SITE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/register.html?payment=cancelled&booking=${encodeURIComponent(id)}`,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(q.dueToday * 100),
            product_data: { name: `Thanksgiving Umrah 2026 — ${q.roomLabel}`, description: `${q.planLabel} · Booking ${id}` },
          },
        }],
        metadata: { booking_id: id, room: q.room, plan: q.plan, package_total: String(q.total) },
        payment_intent_data: { metadata: { booking_id: id, room: q.room, plan: q.plan } },
      });
      booking = await updateBooking(id, b => { b.stripe = { sessionId: session.id }; b.updatedAt = new Date().toISOString(); return b; });
      return res.json({ bookingId: id, quote: q, checkoutUrl: session.url });
    }

    booking = await updateBooking(id, b => { b.status = 'manual_payment_pending_verification'; b.updatedAt = new Date().toISOString(); return b; });
    await Promise.allSettled([
      sendTravelerConfirmation(booking, { pendingManual: true }),
      sendTeamNotification(booking, 'Manual-payment registration'),
    ]);
    return res.json({ bookingId: id, quote: q, manualPayment: true });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(400).json({ error: err.message || 'Unable to create booking' });
  }
});

app.get('/api/checkout-status', async (req, res) => {
  try {
    if (!stripe || !req.query.session_id) return res.status(400).json({ error: 'Missing checkout session' });
    const session = await stripe.checkout.sessions.retrieve(String(req.query.session_id));
    const id = session.metadata?.booking_id;
    if (!id) return res.status(404).json({ error: 'Booking not found' });
    const booking = await getBooking(id);
    res.json({ bookingId: id, status: booking.status, firstName: booking.fields.first_name, email: booking.fields.email, room: booking.quote.roomLabel, plan: booking.quote.planLabel, total: booking.quote.total, paidToday: booking.quote.dueToday, schedule: booking.quote.schedule });
  } catch (err) {
    res.status(400).json({ error: 'Unable to verify checkout status' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Request failed' });
});

await ensureDataDirs();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Halal Trails Umrah site running at http://localhost:${port}`));

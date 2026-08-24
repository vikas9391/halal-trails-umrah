export const EARLY_DEADLINE = new Date('2026-09-07T23:59:59-05:00');
export const TRIP_START = new Date('2026-11-23T00:00:00-06:00');
export const TRIP_END = new Date('2026-12-02T00:00:00-06:00');
export const PASSPORT_MIN_EXPIRY = '2027-06-02';

export const STANDARD = {
  quad: 3299,
  triple: 3449,
  double: 3649,
  single: 4049,
};

export const ROOM_LABELS = {
  quad: 'Quad occupancy',
  triple: 'Triple occupancy',
  double: 'Double occupancy',
  single: 'Single occupancy',
};

export const INSTALLMENTS = {
  quad:   [1450, 617, 616, 616],
  triple: [1450, 666, 667, 666],
  double: [1450, 733, 733, 733],
  single: [1450, 867, 866, 866],
};

export const INSTALLMENT_DATES = [
  'Today',
  'September 24, 2026',
  'October 24, 2026',
  'November 7, 2026',
];

export function isEarly(now = new Date()) {
  return now <= EARLY_DEADLINE;
}

export function quote({ room, plan, now = new Date() }) {
  if (!STANDARD[room]) throw new Error('Invalid room selection');
  if (!['full', 'deposit3', 'land'].includes(plan)) throw new Error('Invalid payment plan');

  const standard = STANDARD[room];
  const earlyEligible = plan === 'full' && isEarly(now);
  let total;
  let dueToday;
  let schedule = [];

  if (plan === 'full') {
    total = earlyEligible ? standard - 200 : standard;
    dueToday = total;
    schedule = [{ label: 'Pay in full', date: 'Today', amount: total }];
  } else if (plan === 'land') {
    total = standard - 900;
    dueToday = total;
    schedule = [{ label: 'Land package payment', date: 'Today', amount: total }];
  } else {
    const amounts = INSTALLMENTS[room];
    total = amounts.reduce((sum, amount) => sum + amount, 0);
    dueToday = amounts[0];
    schedule = amounts.map((amount, i) => ({
      label: i === 0 ? 'Deposit' : `Installment ${i}`,
      date: INSTALLMENT_DATES[i],
      amount,
    }));
  }

  return {
    room,
    roomLabel: ROOM_LABELS[room],
    plan,
    planLabel: plan === 'full' ? 'Pay in full' : plan === 'land' ? 'Land package only' : 'Deposit + 3 installments',
    earlyEligible,
    total,
    dueToday,
    schedule,
    currency: 'usd',
  };
}

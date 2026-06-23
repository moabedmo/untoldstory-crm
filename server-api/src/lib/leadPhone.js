/** توحيد أرقام الجوال — مصر + دولي (نفس منطق src/lib/leadPhone.ts) */

export function normalizeLeadPhone(raw) {
  if (raw == null || raw === '') return '';
  let s = String(raw).trim();
  if (!s) return '';

  if (/^\d+\.?\d*e\+\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
  }

  const hadPlus = s.startsWith('+') || s.includes('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 11 && digits.startsWith('01')) return digits;
  if (digits.length === 10 && digits.startsWith('1')) return `0${digits}`;
  if (digits.startsWith('20') && digits.length === 12 && digits[2] === '1') {
    return `0${digits.slice(2)}`;
  }

  if (digits.length >= 8 && digits.length <= 15) {
    if (hadPlus || digits.length > 11 || !digits.startsWith('0')) {
      return `+${digits}`;
    }
    return digits;
  }

  if (digits.length >= 7 && digits.length <= 15) return digits;
  return digits.slice(0, 15);
}

export function leadPhoneDigitsKey(raw) {
  return normalizeLeadPhone(raw).replace(/\D/g, '');
}

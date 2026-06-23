import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

export function signAccessToken(payload) {
  if (!JWT_SECRET || JWT_SECRET.length < 16) {
    throw new Error('JWT_SECRET مطلوب ويجب أن يكون 16 حرفاً على الأقل');
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyAccessToken(token) {
  if (!JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

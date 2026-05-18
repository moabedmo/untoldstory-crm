import type { TFunction } from 'i18next';
import type { LeadStatus, User } from '@/app/context/DataContext';

/** Display label for lead status (DB value stays Arabic). */
export function getLeadStatusLabel(status: string, t: TFunction): string {
  const key = `leadStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getRoleLabel(role: User['role'], t: TFunction): string {
  const key = `roles.${role}`;
  const translated = t(key);
  return translated === key ? role : translated;
}

export function getDateLocale(lang: 'ar' | 'en'): string {
  return lang === 'en' ? 'en-US' : 'ar-EG';
}

export function getInvoiceStatusLabel(status: string, t: TFunction): string {
  const key = `invoiceStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getExpenseStatusLabel(status: string, t: TFunction): string {
  const key = `expenseStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getApprovalStatusLabel(status: string, t: TFunction): string {
  const key = `approvalStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getSlaStatusLabel(status: string, t: TFunction): string {
  const key = `slaStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getBookingStatusLabel(status: string, t: TFunction): string {
  const key = `bookingStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getExpenseCategoryLabel(category: string, t: TFunction): string {
  const key = `expenseCategory.${category}`;
  const translated = t(key);
  return translated === key ? category : translated;
}

export function getPaymentMethodLabel(method: string, t: TFunction): string {
  const key = `paymentMethod.${method}`;
  const translated = t(key);
  return translated === key ? method : translated;
}

export function getCoaAccountTypeLabel(type: string, t: TFunction): string {
  const key = `coaAccountType.${type}`;
  const translated = t(key);
  return translated === key ? type : translated;
}

export function getBookingFinancialStatusLabel(status: string, t: TFunction): string {
  const key = `bookingFinancialStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getCustodyStatusLabel(status: string, t: TFunction): string {
  const key = `custodyStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export const LEAD_STATUS_VALUES: LeadStatus[] = [
  'جديد',
  'قيد التواصل',
  'عرض سعر',
  'تفاوض',
  'مغلق - فوز',
  'مغلق - خسارة',
];

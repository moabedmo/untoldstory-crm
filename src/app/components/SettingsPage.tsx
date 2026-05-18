import {
  User,
  Bell,
  Shield,
  Palette,
  HelpCircle,
  LogOut,
  ChevronRight,
  Database,
  Mail,
  Link2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useData } from '../context/DataContext';
import { getRoleLabel } from '@/lib/i18nLabels';
import { useAppDirection } from '../hooks/useAppDirection';

function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && typeof Notification.requestPermission === 'function';
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { dir, lang } = useAppDirection();
  const { currentUser, logout, updateEmployeeProfile, desktopNotifyWhenVisible, setDesktopNotifyWhenVisible } = useData();
  const [browserNotifyPerm, setBrowserNotifyPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    browserNotificationsSupported() ? Notification.permission : 'unsupported',
  );

  useEffect(() => {
    if (!browserNotificationsSupported()) return;
    const sync = () => setBrowserNotifyPerm(Notification.permission);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);
  const [name, setName] = useState('');
  const [emailDisplay, setEmailDisplay] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarPreviewBroken, setAvatarPreviewBroken] = useState(false);

  useEffect(() => {
    setName(currentUser?.name || '');
    setEmailDisplay(currentUser?.email || '');
    setAvatarUrl(currentUser?.avatar || '');
  }, [currentUser?.id, currentUser?.name, currentUser?.email, currentUser?.avatar]);

  useEffect(() => {
    setAvatarPreviewBroken(false);
  }, [avatarUrl]);

  const handleSave = async () => {
    if (!currentUser) {
      toast.error(t('settingsProfile.loginFirst'));
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('settingsProfile.nameRequired'));
      return;
    }
    const nextAvatar = avatarUrl.trim();
    const prevAvatar = (currentUser.avatar || '').trim();
    const nameUnchanged = trimmed === (currentUser.name || '').trim();
    const avatarUnchanged = nextAvatar === prevAvatar;
    if (nameUnchanged && avatarUnchanged) {
      toast.message(t('settingsProfile.noChanges'));
      return;
    }
    const patch: { name: string; avatar?: string } = { name: trimmed };
    if (!avatarUnchanged) {
      patch.avatar = nextAvatar?.trim() || undefined;
    }
    const ok = await updateEmployeeProfile(currentUser.id, patch);
    if (ok) toast.success(t('settingsProfile.saveSuccess'));
    else toast.error(t('settingsProfile.saveFailed'));
  };

  const handleCancel = () => {
    if (!currentUser) return;
    setName(currentUser.name || '');
    setAvatarUrl(currentUser.avatar || '');
  };

  const handleLogout = () => {
    logout();
    toast.success(t('common.logoutDone'));
  };

  const roleLabel = currentUser?.role ? getRoleLabel(currentUser.role, t) : '—';

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12" dir={dir}>
      <div>
        <h2 className="text-3xl font-bold text-white mb-2">{t('settingsProfile.title')}</h2>
        <p className="text-zinc-400">{t('settings.languageHint')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="md:col-span-1 space-y-2">
          <SettingTab icon={User} label={t('settingsProfile.tabProfile')} active />
          <SettingTab
            icon={Bell}
            label={t('settingsProfile.tabNotifications')}
            onClick={() =>
              document.getElementById('settings-desktop-notifications')?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }
          />
          <SettingTab icon={Shield} label={t('settingsProfile.tabSecurity')} />
          <SettingTab icon={Palette} label={t('settingsProfile.tabAppearance')} />
          <SettingTab icon={Database} label={t('settingsProfile.tabDataBackup')} />
          <SettingTab icon={HelpCircle} label={t('settingsProfile.tabHelp')} />
          <div className="pt-4 mt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
            >
              <LogOut className="h-5 w-5" />
              <span className="text-sm font-bold">{t('common.logout')}</span>
            </button>
          </div>
        </div>

        <div className="md:col-span-3 space-y-8">
          <div className="bg-[#18181B] border border-zinc-800 rounded-2xl p-8 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-6">{t('settingsProfile.personalInfo')}</h3>
            {!currentUser ? (
              <p className="text-sm text-zinc-500">{t('settingsProfile.noUserContext')}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t('settingsProfile.fullName')}</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50 transition-all"
                  />
                </div>
                <InputGroup label={t('settingsProfile.role')} value={roleLabel} disabled />
                <div className="space-y-2">
                  <label className="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t('settingsProfile.email')}</label>
                  <div className="relative">
                    <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type="text"
                      value={emailDisplay}
                      readOnly
                      className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2.5 pr-10 pl-4 text-sm text-zinc-400 focus:outline-none opacity-80"
                    />
                  </div>
                </div>
                <InputGroup label={t('settingsProfile.userId')} value={currentUser.id} disabled />
              </div>
            )}
            {currentUser ? (
              <div className="mt-8 space-y-4">
                <p className="text-sm text-zinc-500">{t('settingsProfile.avatarSection')}</p>
                <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                  <div className="h-20 w-20 shrink-0 rounded-2xl bg-zinc-800 overflow-hidden flex items-center justify-center text-3xl font-bold text-white">
                    {!avatarPreviewBroken && (avatarUrl.trim() || currentUser.avatar) ? (
                      <img
                        src={avatarUrl.trim() || currentUser.avatar || ''}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => setAvatarPreviewBroken(true)}
                      />
                    ) : (
                      currentUser.name[0] || '?'
                    )}
                  </div>
                  <div className="flex-1 space-y-2 min-w-0">
                    <label className="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t('settingsProfile.avatarUrl')}</label>
                    <div className="relative">
                      <Link2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                      <input
                        type="url"
                        inputMode="url"
                        placeholder="https://…"
                        value={avatarUrl}
                        onChange={(e) => setAvatarUrl(e.target.value)}
                        className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2.5 pr-10 pl-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50 transition-all"
                      />
                    </div>
                    <p className="text-xs text-zinc-500">
                      {t('settingsProfile.avatarUrlHint')}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div
            id="settings-desktop-notifications"
            className="bg-[#18181B] border border-zinc-800 rounded-2xl p-8 shadow-xl scroll-mt-8"
          >
            <div className="flex items-start gap-3 mb-6">
              <Bell className="h-6 w-6 text-[#6366F1] shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-white">{t('settingsProfile.notifySection')}</h3>
                <p className="text-sm text-zinc-500 mt-1">
                  {t('settingsProfile.notifyDesktopHint')}
                </p>
              </div>
            </div>
            {!browserNotificationsSupported() ? (
              <p className="text-sm text-zinc-500">{t('settingsProfile.browserUnsupported')}</p>
            ) : (
              <div className="space-y-4 rounded-xl border border-zinc-800 bg-[#09090B] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-bold text-white">{t('settingsProfile.notifyPermission')}</span>
                  {browserNotifyPerm === 'granted' && <span className="text-xs text-emerald-400 font-bold">{t('settingsProfile.notifyEnabled')}</span>}
                  {browserNotifyPerm === 'denied' && (
                    <span className="text-xs text-rose-300 text-right max-w-md">
                      {t('settingsProfile.notifyDeniedHint')}
                    </span>
                  )}
                  {browserNotifyPerm === 'default' && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const r = await Notification.requestPermission();
                          setBrowserNotifyPerm(r);
                          if (r === 'granted') toast.success(t('settingsProfile.toastNotifyEnabled'));
                          else if (r === 'denied') toast.info(t('settingsProfile.toastNotifyDeniedLater'));
                        } catch {
                          toast.error(t('settingsProfile.toastNotifyRequestFailed'));
                        }
                      }}
                      className="text-xs font-bold px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 transition-colors"
                    >
                      {t('settingsProfile.enableDesktopNotify')}
                    </button>
                  )}
                </div>
                {browserNotifyPerm === 'granted' && (
                  <label className="flex items-start gap-3 cursor-pointer text-sm text-zinc-400 leading-relaxed">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[#6366F1]"
                      checked={desktopNotifyWhenVisible}
                      onChange={(e) => setDesktopNotifyWhenVisible(e.target.checked)}
                    />
                    <span>
                      {t('settingsProfile.notifyWhenTabOpen')}
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          <div className="bg-[#18181B] border border-zinc-800 rounded-2xl p-8 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-6">{t('settingsProfile.systemSettingsPreview')}</h3>
            <div className="space-y-6">
              <ToggleGroup label={t('settingsProfile.previewLanguage')} description={t('settingsProfile.previewLanguageDesc')} value={lang === 'en' ? t('settingsProfile.languageEnglish') : t('settingsProfile.languageArabic')} />
              <ToggleGroup label={t('settingsProfile.previewSessionSource')} description={t('settingsProfile.previewSessionSourceDesc')} value={currentUser?.authSource === 'database' ? t('settingsProfile.sessionDatabase') : t('settingsProfile.sessionLocal')} />
              <ToggleGroup label={t('settingsProfile.previewConnection')} description={t('settingsProfile.previewConnectionDesc')} value={import.meta.env.VITE_DATA_SOURCE === 'server' ? t('settingsProfile.connectionServer') : t('settingsProfile.connectionLocal')} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={handleCancel}
              className="px-6 py-2.5 text-zinc-400 font-bold hover:text-white transition-all"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="bg-[#6366F1] text-white px-8 py-2.5 rounded-xl font-bold hover:bg-[#5254E2] transition-all shadow-lg shadow-[#6366F1]/20"
            >
              {t('settingsProfile.saveChanges')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingTab({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof User;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between w-full px-4 py-3 rounded-xl transition-all group ${
        active ? 'bg-[#6366F1] text-white shadow-lg shadow-[#6366F1]/20' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5" />
        <span className="text-sm font-bold">{label}</span>
      </div>
      <ChevronRight className={`h-4 w-4 transition-transform ${active ? 'rotate-90' : 'group-hover:translate-x-[-4px]'}`} />
    </button>
  );
}

function InputGroup({ label, value, icon: Icon, disabled }: { label: string; value: string; icon?: typeof Mail; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-zinc-500 font-bold uppercase tracking-wider">{label}</label>
      <div className="relative">
        {Icon && <Icon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />}
        <input
          type="text"
          value={value}
          readOnly={disabled}
          disabled={disabled}
          className={`w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2.5 ${Icon ? 'pr-10' : 'pr-4'} pl-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50 transition-all ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        />
      </div>
    </div>
  );
}

function ToggleGroup({ label, description, value }: { label: string; description: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-bold text-white mb-0.5">{label}</p>
        <p className="text-xs text-zinc-500 font-medium">{description}</p>
      </div>
      <span className="bg-zinc-800 border border-zinc-700 text-white text-xs font-bold px-4 py-2 rounded-lg">{value}</span>
    </div>
  );
}

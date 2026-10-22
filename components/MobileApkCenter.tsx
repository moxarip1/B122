import React, { useEffect, useState, useCallback } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { XCircleIcon } from './Icons';

interface ApkMetadata {
  versionName: string;
  versionCode: number;
  buildTimestamp: string;
  packageName: string;
  appName: string;
  fileSize: number;
  sha256: string;
  bundledFilesCount: number;
  autoSyncEnabled: boolean;
}

export const MobileApkCenter: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [apkInfo, setApkInfo] = useState<ApkMetadata | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const fetchApkInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/apk-info');
      if (res.ok) {
        const data = await res.json();
        setApkInfo(data);
      }
    } catch {
      // ignore network error
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchApkInfo();
    }
  }, [isOpen, fetchApkInfo]);

  const handleRebuildApk = async () => {
    setIsRebuilding(true);
    try {
      const res = await fetch('/api/apk-rebuild', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setApkInfo(data);
      }
    } finally {
      setIsRebuilding(false);
    }
  };

  if (!isOpen) return null;

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 KB';
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-2xl p-6 text-white shadow-2xl space-y-5 max-h-[88vh] overflow-y-auto">
        {/* Grab handle on mobile */}
        <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto -mt-2 mb-2 sm:hidden" />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white">
              نسخة الهاتف المحمول (debug.apk)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              تحديث تلقائي مستمر مع كل تعديل حالي أو مستقبلي
            </p>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-white rounded-full"
            aria-label="Close Mobile APK Modal"
          >
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>

        {/* APK Status & Details */}
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3 text-xs">
          <div className="flex items-center justify-between text-slate-300">
            <span>مسار الملف:</span>
            <code className="font-mono text-cyan-400">/debug/debug.apk</code>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span>رقم الإصدار (Auto-Sync):</span>
            <span className="font-mono tabular-nums text-white font-medium">
              {apkInfo ? apkInfo.versionName : 'جاري التحقق...'}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span>الحجم والملفات المدمجة:</span>
            <span className="font-mono tabular-nums text-slate-300">
              {apkInfo ? `${formatBytes(apkInfo.fileSize)} · ${apkInfo.bundledFilesCount} ملف` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span>آخر مزامنة تلقائية:</span>
            <span className="font-mono tabular-nums text-slate-400">
              {apkInfo ? new Date(apkInfo.buildTimestamp).toLocaleTimeString() : '—'}
            </span>
          </div>
          {apkInfo?.sha256 && (
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>بصمة التحديث (SHA-256):</span>
              <span className="font-mono">{apkInfo.sha256.slice(0, 16)}...</span>
            </div>
          )}
        </div>

        {/* Primary Actions */}
        <div className="space-y-2.5">
          <a
            href="/debug/debug.apk"
            download="debug.apk"
            className="w-full min-h-[48px] rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-lg">android</span>
            <span>تحميل ملف debug.apk المحدث</span>
          </a>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleRebuildApk}
              disabled={isRebuilding}
              className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">sync</span>
              <span>{isRebuilding ? 'جاري التحديث...' : 'مزامنة وبناء الآن'}</span>
            </button>

            {isInstallable && !isInstalled ? (
              <button
                type="button"
                onClick={install}
                className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-cyan-500/40 text-cyan-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-base">install_mobile</span>
                <span>تثبيت مباشر (PWA)</span>
              </button>
            ) : isIOS && !isInstalled ? (
              <button
                type="button"
                onClick={() => setShowIOSGuide(!showIOSGuide)}
                className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-base">ios_share</span>
                <span>تثبيت على iOS</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen?.().catch(() => {});
                  } else {
                    document.exitFullscreen?.().catch(() => {});
                  }
                }}
                className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-base">fullscreen</span>
                <span>ملء الشاشة للهاتف</span>
              </button>
            )}
          </div>
        </div>

        {showIOSGuide && (
          <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-slate-200 space-y-1">
            <p className="font-semibold text-white">تثبيت اللعبة على iPhone / iPad:</p>
            <p>1. اضغط على زر المشاركة (Share) في متصفح Safari.</p>
            <p>2. اختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen).</p>
          </div>
        )}

        <p className="text-[11px] text-slate-400 leading-relaxed text-right" dir="rtl">
          يتم مراقبة جميع ملفات اللعبة تلقائياً في الخلفية؛ أي تعديل حالي أو مستقبلي يتم دمجه فوراً داخل{' '}
          <span className="font-mono text-slate-300">debug/debug.apk</span>.
        </p>
      </div>
    </div>
  );
};

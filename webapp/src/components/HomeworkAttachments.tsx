import { CloseIcon, DownloadIcon, FileIcon, PaperclipIcon, ChevronLeft, ChevronRight } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import { webApp, openExternal } from '../bridge/max';
import { t, useI18n } from '../lib/i18n';

export type HomeworkAttachment = { id: string; name: string; size: number; mime: string };
// Размер по-русски или по-английски: «39,6 КБ», «1.2 MB».
export const fileSize = (size: number) => {
  const { locale, units } = t();
  const [value, unit] = size < 1024 * 1024 ? [size / 1024, units.kb] : [size / 1024 / 1024, units.mb];
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${unit}`;
};

const previewImage = (file: HomeworkAttachment) => ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'].includes(file.mime);

const compressPhoto = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/')) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Image conversion failed')), 'image/jpeg', 0.82));
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(url); }
};

const upload = async (file: File, scope: string, progress: (value: number) => void): Promise<HomeworkAttachment> => {
  const compressed = await compressPhoto(file);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/attachments?scope=${scope}&name=${encodeURIComponent(compressed.name)}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    if (webApp()?.initData) request.setRequestHeader('Authorization', `tma ${webApp()!.initData}`);
    if (import.meta.env.DEV) request.setRequestHeader('X-Demo-User', new URLSearchParams(location.search).get('demoUser') ?? '1');
    request.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => reject(new Error('Ошибка сети / Network error'));
    request.timeout = 120_000;
    request.ontimeout = request.onerror;
    request.onload = () => {
      let body;
      try { body = JSON.parse(request.responseText); } catch { reject(new Error('Ошибка загрузки / Upload failed')); return; }
      if (request.status >= 200 && request.status < 300) resolve(body.item);
      else reject(new Error(body.message || 'Ошибка загрузки / Upload failed'));
    };
    request.send(compressed);
  });
};

type Draft = { key: string; file: File; preview?: string; progress: number; error?: string; item?: HomeworkAttachment };
export const AttachmentEditor = ({ files, scope, onChange, onBusy }: {
  files: HomeworkAttachment[]; scope: 'shared' | 'personal'; onChange: (files: HomeworkAttachment[]) => void; onBusy: (busy: boolean) => void;
}) => {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const latest = useRef(files);
  latest.current = files;
  const urls = useRef<string[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; urls.current.forEach((url) => URL.revokeObjectURL(url)); }; }, []);
  useEffect(() => { onBusy(drafts.some((draft) => !draft.item)); }, [drafts, onBusy]);
  const start = async (draft: Draft) => {
    setDrafts((items) => items.map((item) => item.key === draft.key ? { ...item, error: undefined, progress: 0 } : item));
    try {
      const item = await upload(draft.file, scope, (progress) => { if (mounted.current) setDrafts((items) => items.map((value) => value.key === draft.key ? { ...value, progress } : value)); });
      if (!mounted.current) return;
      setDrafts((items) => items.map((value) => value.key === draft.key ? { ...value, item } : value));
      onChange([...latest.current, item]);
    } catch (error) { if (mounted.current) setDrafts((items) => items.map((value) => value.key === draft.key ? { ...value, error: (error as Error).message } : value)); }
  };
  const pendingIds = new Set(drafts.map((draft) => draft.item?.id));
  const remove = (id: string) => onChange(files.filter((item) => item.id !== id));
  const saved = files.filter((file) => !pendingIds.has(file.id));
  return <div className="attachment-editor">
    {(saved.length > 0 || drafts.length > 0) && <ul className="files">
      {saved.map((file) => <li key={file.id} className="file">
        <FileIcon size={18} className="file__icon" />
        <span className="file__text"><span className="file__name">{file.name}</span><span className="file__size">{fileSize(file.size)}</span></span>
        <button type="button" className="file__action" aria-label={`${t.removeAttachment}: ${file.name}`} onClick={() => remove(file.id)}><CloseIcon size={16} /></button>
      </li>)}
      {drafts.map((draft) => <li key={draft.key} className="file">
        {draft.preview ? <img className="file__thumb" src={draft.preview} alt="" /> : <FileIcon size={18} className="file__icon" />}
        <span className="file__text">
          <span className="file__name">{draft.item?.name ?? draft.file.name}</span>
          {draft.error ? <span className="file__error" role="alert">{draft.error}</span>
            : draft.item ? <span className="file__size">{fileSize(draft.item.size)}</span>
              : <progress className="file__progress" aria-label={t.uploadingFile} value={draft.progress} max={100} />}
        </span>
        {draft.error && <button type="button" className="text-button" onClick={() => void start(draft)}>{t.retryAttachment}</button>}
        {(draft.item || draft.error) && <button type="button" className="file__action" aria-label={t.removeAttachment} onClick={() => {
          setDrafts((items) => items.filter((item) => item.key !== draft.key));
          if (draft.item) { remove(draft.item.id); void apiRequest(`/api/attachments/${draft.item.id}`, { method: 'DELETE' }).catch(() => {}); }
        }}><CloseIcon size={16} /></button>}
      </li>)}
    </ul>}
    <label className="attach-button"><PaperclipIcon size={18} />{t.attachFiles}<input aria-label={t.attachFiles} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.zip,.7z,.rar,.gz,.tar,audio/*,video/*" onChange={(event) => {
      const selected = Array.from(event.target.files ?? []).map((file): Draft => {
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        if (preview) urls.current.push(preview);
        return { key: crypto.randomUUID(), file, preview, progress: 0 };
      });
      setDrafts((items) => [...items, ...selected]);
      // Файлы грузятся по одному: на телефоне так меньше памяти и трафика одновременно.
      void (async () => { for (const draft of selected) await start(draft); })();
      event.target.value = '';
    }} /></label>
  </div>;
};

export const AttachmentList = ({ files = [] }: { files?: HomeworkAttachment[] }) => {
  const { t } = useI18n();
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const touchStart = useRef(0);
  const key = files.map((file) => file.id).join(',');
  useEffect(() => {
    let active = true;
    const load = () => Promise.all(files.map(async (file) => {
      const result = await apiRequest<{ url: string }>(`/api/attachments/${file.id}/link`);
      return [file.id, new URL(result.url, location.origin).href];
    })).then((items) => { if (active) { setLinks(Object.fromEntries(items)); setError(''); } }).catch((error: Error) => { if (active) setError(error.message); });
    void load();
    const timer = window.setInterval(() => void load(), 4 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [key, revision]);
  useEffect(() => { if (selected !== null && !dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  const photos = files.filter(previewImage);
  const move = (offset: number) => setSelected((current) => current === null ? null : (current + offset + photos.length) % photos.length);
  if (!files.length) return null;
  const download = (event: React.MouseEvent<HTMLAnchorElement>, file: HomeworkAttachment) => {
    const url = links[file.id];
    if (!url) { event.preventDefault(); return; }
    const app = webApp();
    if (app?.initData && app.downloadFile) {
      event.preventDefault();
      try { void Promise.resolve(app.downloadFile(url, file.name)).catch((error: unknown) => setError(error instanceof Error ? error.message : t.failed)); }
      catch (error) { setError(error instanceof Error ? error.message : t.failed); }
    }
    else if (openExternal(url)) event.preventDefault();
  };
  const documents = files.filter((file) => !previewImage(file));
  return <div className="homework-attachments">
    {error && <p className="callout callout--error" role="alert">{error} <button type="button" className="text-button" onClick={() => setRevision((value) => value + 1)}>{t.retryAttachment}</button></p>}
    {photos.length > 0 && <div className="photos">{photos.map((file, index) => <button type="button" className="photo" key={file.id} disabled={!links[file.id]} onClick={() => setSelected(index)} aria-label={`${t.openAttachment}: ${file.name}`}>
      {links[file.id] && <img loading="lazy" src={links[file.id]} alt={file.name} width={88} height={88} />}
    </button>)}</div>}
    {documents.length > 0 && <ul className="files">{documents.map((file) => <li key={file.id}>
      <a className="file file--link" href={links[file.id]} download={file.name} aria-disabled={!links[file.id]} onClick={(event) => download(event, file)}>
        <FileIcon size={18} className="file__icon" />
        <span className="file__text"><span className="file__name">{file.name}</span><span className="file__size">{fileSize(file.size)}</span></span>
        <DownloadIcon size={18} className="file__icon" />
      </a>
    </li>)}</ul>}
    {selected !== null && photos[selected] && <dialog ref={dialog} className="gallery" onClose={() => setSelected(null)} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); }} aria-label={t.photoGallery}>
      <div className="gallery__bar">
        <span className="gallery__count">{selected + 1} / {photos.length}</span>
        <button type="button" className="gallery__button" aria-label={t.closeAttachment} onClick={() => dialog.current?.close()}><CloseIcon size={20} /></button>
      </div>
      <img src={links[photos[selected].id]} alt={photos[selected].name} onTouchStart={(event) => { touchStart.current = event.changedTouches[0].clientX; }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - touchStart.current; if (Math.abs(delta) > 40) move(delta < 0 ? 1 : -1); }} />
      {photos.length > 1 && <nav className="gallery__bar">
        <button type="button" className="gallery__button" aria-label={t.previousPhoto} onClick={() => move(-1)}><ChevronLeft size={22} /></button>
        <button type="button" className="gallery__button" aria-label={t.nextPhoto} onClick={() => move(1)}><ChevronRight size={22} /></button>
      </nav>}
    </dialog>}
  </div>;
};

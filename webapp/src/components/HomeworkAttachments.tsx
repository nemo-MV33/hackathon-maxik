import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import { webApp, openExternal } from '../bridge/max';
import { useI18n } from '../lib/i18n';

export type HomeworkAttachment = { id: string; name: string; size: number; mime: string };
export const fileSize = (size: number) => size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

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
  return <div className="attachment-editor">
    <label className="pill-button attach-label">{t.attachFiles}<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.zip,.7z,.rar,.gz,.tar,audio/*,video/*" onChange={(event) => {
      const selected = Array.from(event.target.files ?? []).map((file): Draft => {
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        if (preview) urls.current.push(preview);
        return { key: crypto.randomUUID(), file, preview, progress: 0 };
      });
      setDrafts((items) => [...items, ...selected]);
      // Sequential uploads keep memory and network usage bounded on phones.
      void (async () => { for (const draft of selected) await start(draft); })();
      event.target.value = '';
    }} /></label>
    <AttachmentList files={files.filter((file) => previewImage(file) && !pendingIds.has(file.id))} />
    <ul className="attachment-files">
      {files.filter((file) => !pendingIds.has(file.id)).map((file) => <li key={file.id}><span>{file.name} · {fileSize(file.size)}</span><button type="button" onClick={() => onChange(files.filter((item) => item.id !== file.id))}>{t.removeAttachment}</button></li>)}
      {drafts.map((draft) => <li key={draft.key}>
        {draft.preview && <img className="attachment-thumb" src={draft.preview} alt={draft.file.name} />}
        <span>{draft.item?.name ?? draft.file.name}{draft.item && ` · ${fileSize(draft.item.size)}`}</span>
        {!draft.item && !draft.error && <progress aria-label={t.uploadingFile} value={draft.progress} max={100} />}
        {draft.error && <><span role="alert">{draft.error}</span><button type="button" onClick={() => void start(draft)}>{t.retryAttachment}</button></>}
        {(draft.item || draft.error) && <button type="button" onClick={() => { setDrafts((items) => items.filter((item) => item.key !== draft.key)); if (draft.item) { onChange(files.filter((item) => item.id !== draft.item!.id)); void apiRequest(`/api/attachments/${draft.item.id}`, { method: 'DELETE' }).catch(() => {}); } }}>{t.removeAttachment}</button>}
      </li>)}
    </ul>
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
  return <div className="homework-attachments">
    {error && <p role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t.retryAttachment}</button></p>}
    <div className="attachment-photos">{photos.map((file, index) => <button type="button" key={file.id} disabled={!links[file.id]} onClick={() => setSelected(index)} aria-label={`${t.openAttachment}: ${file.name}`}>
      <img loading="lazy" src={links[file.id]} alt={file.name} width={96} height={96} />
    </button>)}</div>
    <ul className="attachment-files">{files.filter((file) => !previewImage(file)).map((file) => <li key={file.id}>
      <span>{file.name} · {fileSize(file.size)}</span>
      <a href={links[file.id]} download={file.name} aria-disabled={!links[file.id]} onClick={(event) => {
        const url = links[file.id];
        if (!url) { event.preventDefault(); return; }
        const app = webApp();
        if (app?.initData && app.downloadFile) {
          event.preventDefault();
          try { void Promise.resolve(app.downloadFile(url, file.name)).catch((error: unknown) => setError(error instanceof Error ? error.message : t.failed)); }
          catch (error) { setError(error instanceof Error ? error.message : t.failed); }
        }
        else if (openExternal(url)) event.preventDefault();
      }}>{t.openAttachment}</a>
    </li>)}</ul>
    {selected !== null && photos[selected] && <dialog ref={dialog} className="attachment-gallery" onClose={() => setSelected(null)} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); }} aria-label={t.photoGallery}>
      <button type="button" onClick={() => dialog.current?.close()}>{t.closeAttachment}</button>
      <img src={links[photos[selected].id]} alt={photos[selected].name} onTouchStart={(event) => { touchStart.current = event.changedTouches[0].clientX; }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - touchStart.current; if (Math.abs(delta) > 40) move(delta < 0 ? 1 : -1); }} />
      <nav><button type="button" onClick={() => move(-1)}>{t.previousPhoto}</button><span>{selected + 1} / {photos.length}</span><button type="button" onClick={() => move(1)}>{t.nextPhoto}</button></nav>
    </dialog>}
  </div>;
};

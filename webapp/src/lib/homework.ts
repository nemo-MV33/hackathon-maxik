import { useEffect, useState } from 'react';
import type { Lesson } from '../data/schedule';

export type Homework = {
  groupId: number;
  date: string;
  lessonNumber: number;
  subgroup: number | null;
  subject: string;
  text: string;
  updatedAt: string;
  sharedBy?: 'me' | 'import';
};

const KEY = 'norfly.homework';
const EVENT = 'norfly:homework';
// Ссылка MAX принимает до 512 символов в startapp, оставляем запас на префикс
const MAX_PAYLOAD = 500;

export const homeworkId = (groupId: number, lesson: Pick<Lesson, 'date' | 'lessonNumber' | 'subgroup'>) =>
  `${groupId}:${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`;

const readAll = (): Record<string, Homework> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
};

const writeAll = (items: Record<string, Homework>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Хранилище переполнено или недоступно — изменения останутся до перезапуска
  }
  window.dispatchEvent(new Event(EVENT));
};

export const saveHomework = (item: Homework) => {
  const items = readAll();
  items[homeworkId(item.groupId, item)] = item;
  writeAll(items);
};

export const removeHomework = (id: string) => {
  const items = readAll();
  delete items[id];
  writeAll(items);
};

export const useHomework = () => {
  const [items, setItems] = useState(readAll);
  useEffect(() => {
    const update = () => setItems(readAll());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return items;
};

// ---- Передача ДЗ через ссылку на мини-приложение ----
// Формат: hw1<z|j><base64url>, внутри JSON [groupId, date, lessonNumber, subgroup, text]

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};

const pipe = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());

const canCompress = typeof CompressionStream !== 'undefined';

export const encodeHomework = async (item: Homework) => {
  const json = new TextEncoder().encode(JSON.stringify([
    item.groupId, item.date, item.lessonNumber, item.subgroup, item.text,
  ]));
  if (canCompress) {
    const compressed = await pipe(json, new CompressionStream('deflate-raw'));
    if (compressed.length < json.length) return `hw1z${toBase64Url(compressed)}`;
  }
  return `hw1j${toBase64Url(json)}`;
};

export const fitsInLink = async (item: Homework) => (await encodeHomework(item)).length <= MAX_PAYLOAD;

export type SharedHomework = Pick<Homework, 'groupId' | 'date' | 'lessonNumber' | 'subgroup' | 'text'>;

export const decodeHomework = async (payload: string): Promise<SharedHomework | null> => {
  const match = payload.match(/^hw1([zj])([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  try {
    let bytes = fromBase64Url(match[2]);
    if (match[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    const [groupId, date, lessonNumber, subgroup, text] = JSON.parse(new TextDecoder().decode(bytes));
    if (!Number.isInteger(groupId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(lessonNumber)) return null;
    if (typeof text !== 'string' || !text.trim()) return null;
    return { groupId, date, lessonNumber, subgroup: subgroup === 1 || subgroup === 2 ? subgroup : null, text: text.slice(0, 1000) };
  } catch {
    return null;
  }
};
